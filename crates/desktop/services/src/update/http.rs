// Copyright (C) 2024-2026 Sjors Robroek
// SPDX-License-Identifier: AGPL-3.0-only

//! Where the updater reads the manifest and the payload from.

use std::future::Future;
use std::io;
use std::pin::Pin;
use std::time::Duration;

use reqwest::header::ACCEPT;
use reqwest::{StatusCode, Url};

use super::UpdateError;

pub type BoxFuture<'a, T> = Pin<Box<dyn Future<Output = T> + Send + 'a>>;

/// Receives each downloaded chunk in order; an error stops the download.
pub type ChunkSink<'a> = dyn FnMut(&[u8]) -> io::Result<()> + Send + 'a;

/// The network side of the updater: the HTTPS client in the app, a fake that
/// counts requests in tests.
pub trait Source: Send + Sync {
    /// The manifest at `url`, or `None` when the endpoint answers
    /// `204 No Content` (no update).
    fn manifest<'a>(&'a self, url: &'a Url) -> BoxFuture<'a, Result<Option<Vec<u8>>, UpdateError>>;

    /// Stream the payload at `url` into `sink`.
    fn download<'a>(
        &'a self,
        url: &'a Url,
        sink: &'a mut ChunkSink<'_>,
    ) -> BoxFuture<'a, Result<(), UpdateError>>;
}

/// How long a manifest request may take in total.
const MANIFEST_TIMEOUT: Duration = Duration::from_secs(60);
/// How long connecting, and each read of a download, may take.
const STALL_TIMEOUT: Duration = Duration::from_secs(60);

/// How much the client reads before it gives up on a response.
#[derive(Clone, Copy, Debug)]
struct Limits {
    manifest_bytes: u64,
    payload_bytes: u64,
    /// How long a whole download may take, so a server that drips bytes
    /// cannot hold the updater in `Downloading`.
    download_deadline: Duration,
}

impl Limits {
    /// `latest.json` is a few kilobytes and the largest `PlateVault` bundle
    /// is well under 1 GiB. An hour downloads that over a slow connection.
    const APP: Self = Self {
        manifest_bytes: 1 << 20,
        payload_bytes: 1 << 30,
        download_deadline: Duration::from_hours(1),
    };
}

/// The HTTPS client. Follows redirects, as GitHub's `releases/latest/download`
/// URLs need, but only to HTTPS, and uses the system proxy and certificate
/// store.
pub struct Http {
    client: reqwest::Client,
    limits: Limits,
}

impl Http {
    pub fn new(user_agent: &str) -> Result<Self, UpdateError> {
        Self::build(user_agent, true, Limits::APP)
    }

    /// `https_only` refuses a plain-HTTP URL, including one a redirect leads
    /// to; only tests against a local plain-HTTP server turn it off.
    fn build(user_agent: &str, https_only: bool, limits: Limits) -> Result<Self, UpdateError> {
        let client = reqwest::Client::builder()
            .user_agent(user_agent)
            .https_only(https_only)
            .connect_timeout(STALL_TIMEOUT)
            .read_timeout(STALL_TIMEOUT)
            .build()
            .map_err(|error| {
                UpdateError::Config(format!("cannot build the HTTP client: {error}"))
            })?;
        Ok(Self { client, limits })
    }
}

impl Source for Http {
    fn manifest<'a>(&'a self, url: &'a Url) -> BoxFuture<'a, Result<Option<Vec<u8>>, UpdateError>> {
        Box::pin(async move {
            let response = self
                .client
                .get(url.clone())
                .header(ACCEPT, "application/json")
                .timeout(MANIFEST_TIMEOUT)
                .send()
                .await
                .map_err(network)?;
            if response.status() == StatusCode::NO_CONTENT {
                return Ok(None);
            }
            let response = response.error_for_status().map_err(network)?;
            let mut body = Vec::new();
            read_body(response, "update manifest", self.limits.manifest_bytes, &mut |chunk| {
                body.extend_from_slice(chunk);
                Ok(())
            })
            .await?;
            Ok(Some(body))
        })
    }

    fn download<'a>(
        &'a self,
        url: &'a Url,
        sink: &'a mut ChunkSink<'_>,
    ) -> BoxFuture<'a, Result<(), UpdateError>> {
        Box::pin(async move {
            let response = self
                .client
                .get(url.clone())
                .header(ACCEPT, "application/octet-stream")
                // Covers the body too, not only the request.
                .timeout(self.limits.download_deadline)
                .send()
                .await
                .map_err(network)?
                .error_for_status()
                .map_err(network)?;
            read_body(response, "update", self.limits.payload_bytes, sink).await
        })
    }
}

/// Stream `response`'s body into `sink`, refusing it once it is, or says it
/// is, longer than `limit` bytes.
async fn read_body(
    mut response: reqwest::Response,
    what: &str,
    limit: u64,
    sink: &mut ChunkSink<'_>,
) -> Result<(), UpdateError> {
    let too_large = || {
        UpdateError::Network(format!("the {what} is larger than {limit} bytes, so it was not read"))
    };
    if response.content_length().is_some_and(|length| length > limit) {
        return Err(too_large());
    }
    let mut received: u64 = 0;
    while let Some(chunk) = response.chunk().await.map_err(network)? {
        received = received.saturating_add(u64::try_from(chunk.len()).unwrap_or(u64::MAX));
        if received > limit {
            return Err(too_large());
        }
        sink(&chunk)?;
    }
    Ok(())
}

fn network(error: reqwest::Error) -> UpdateError {
    UpdateError::Network(error.without_url().to_string())
}

#[cfg(test)]
mod tests {
    //! The HTTP client against a local server speaking plain HTTP/1.1.

    use std::time::{Duration, Instant};

    use reqwest::Url;
    use tokio::io::{AsyncReadExt as _, AsyncWriteExt as _};
    use tokio::net::TcpListener;

    use super::{Http, Limits, Source};
    use crate::update::UpdateError;

    /// How a test route answers.
    enum Body {
        /// With a `Content-Length`.
        Sized(Vec<u8>),
        /// Without one: the body ends when the connection closes.
        Unsized(Vec<u8>),
        /// Announces 1000 bytes, sends one, then stops sending.
        Stalling,
    }

    /// Serve `routes` (path, status line, body) until the test ends; any
    /// other path is a 404. Returns the server's base URL.
    async fn serve(routes: Vec<(&'static str, &'static str, Body)>) -> Url {
        let listener = TcpListener::bind("127.0.0.1:0").await.expect("bind");
        let base = Url::parse(&format!("http://{}/", listener.local_addr().expect("address")))
            .expect("base url");
        tokio::spawn(async move {
            while let Ok((mut stream, _)) = listener.accept().await {
                let mut request = Vec::new();
                let mut buffer = [0_u8; 1024];
                while !request.windows(4).any(|window| window == b"\r\n\r\n") {
                    let read = stream.read(&mut buffer).await.expect("read");
                    if read == 0 {
                        break;
                    }
                    request.extend_from_slice(&buffer[..read]);
                }
                let request = String::from_utf8_lossy(&request);
                let path = request.split_whitespace().nth(1).unwrap_or_default();
                let not_found = Body::Sized(Vec::new());
                let (status, body) = routes
                    .iter()
                    .find(|(route, _, _)| *route == path)
                    .map_or(("404 Not Found", &not_found), |(_, status, body)| (*status, body));
                let (length, bytes) = match body {
                    Body::Sized(bytes) => {
                        (format!("Content-Length: {}\r\n", bytes.len()), &bytes[..])
                    }
                    Body::Unsized(bytes) => (String::new(), &bytes[..]),
                    Body::Stalling => ("Content-Length: 1000\r\n".to_owned(), &b"x"[..]),
                };
                let head = format!("HTTP/1.1 {status}\r\n{length}Connection: close\r\n\r\n");
                stream.write_all(head.as_bytes()).await.expect("write head");
                // The client may hang up early on a body it refuses.
                let _ = stream.write_all(bytes).await;
                if matches!(body, Body::Stalling) {
                    tokio::time::sleep(Duration::from_secs(30)).await;
                }
                let _ = stream.shutdown().await;
            }
        });
        base
    }

    /// A client for the plain-HTTP test server.
    fn plain_http(limits: Limits) -> Http {
        Http::build("PlateVault/test", false, limits).expect("client")
    }

    fn http() -> Http {
        plain_http(Limits::APP)
    }

    #[tokio::test]
    async fn the_manifest_body_is_returned() {
        let base = serve(vec![(
            "/latest.json",
            "200 OK",
            Body::Sized(b"{\"version\":\"0.7.0\"}".to_vec()),
        )])
        .await;
        let manifest =
            http().manifest(&base.join("latest.json").expect("url")).await.expect("fetch");
        assert_eq!(manifest.as_deref(), Some(&b"{\"version\":\"0.7.0\"}"[..]));
    }

    #[tokio::test]
    async fn no_content_means_no_update() {
        let base = serve(vec![("/latest.json", "204 No Content", Body::Sized(Vec::new()))]).await;
        let manifest =
            http().manifest(&base.join("latest.json").expect("url")).await.expect("fetch");
        assert_eq!(manifest, None);
    }

    #[tokio::test]
    async fn an_error_status_fails_the_request() {
        let base = serve(Vec::new()).await;
        let error =
            http().manifest(&base.join("latest.json").expect("url")).await.expect_err("404");
        assert!(
            matches!(&error, UpdateError::Network(message) if message.contains("404")),
            "{error}"
        );
    }

    #[tokio::test]
    async fn a_download_streams_the_whole_payload() {
        let payload: Vec<u8> = (0..200_000_u32).map(|n| n.to_le_bytes()[0]).collect();
        let base = serve(vec![("/update.AppImage", "200 OK", Body::Sized(payload.clone()))]).await;
        let mut received = Vec::new();
        http()
            .download(&base.join("update.AppImage").expect("url"), &mut |chunk| {
                received.extend_from_slice(chunk);
                Ok(())
            })
            .await
            .expect("download");
        assert_eq!(received, payload);
    }

    /// The app's client refuses plain HTTP before it connects, so neither an
    /// `http:` URL nor a redirect to one is followed (reqwest's redirect
    /// policy checks `https_only` for every hop).
    #[tokio::test]
    async fn the_app_client_refuses_plain_http() {
        let base = serve(vec![("/latest.json", "200 OK", Body::Sized(b"{}".to_vec()))]).await;
        let client = Http::new("PlateVault/test").expect("client");
        let error =
            client.manifest(&base.join("latest.json").expect("url")).await.expect_err("http");
        assert!(matches!(error, UpdateError::Network(_)), "{error}");
    }

    #[tokio::test]
    async fn a_manifest_over_its_limit_is_refused() {
        let base = serve(vec![("/latest.json", "200 OK", Body::Sized(vec![b' '; 64]))]).await;
        let client = plain_http(Limits { manifest_bytes: 32, ..Limits::APP });
        let error =
            client.manifest(&base.join("latest.json").expect("url")).await.expect_err("too large");
        assert!(
            matches!(&error, UpdateError::Network(message) if message.contains("larger than 32 bytes")),
            "{error}"
        );
    }

    #[tokio::test]
    async fn a_payload_that_announces_more_than_its_limit_is_not_read() {
        let base = serve(vec![("/update.AppImage", "200 OK", Body::Sized(vec![0; 64]))]).await;
        let client = plain_http(Limits { payload_bytes: 32, ..Limits::APP });
        let mut received = 0;
        let error = client
            .download(&base.join("update.AppImage").expect("url"), &mut |chunk| {
                received += chunk.len();
                Ok(())
            })
            .await
            .expect_err("too large");
        assert!(
            matches!(&error, UpdateError::Network(message) if message.contains("larger than 32 bytes")),
            "{error}"
        );
        assert_eq!(received, 0, "nothing reaches the staging file");
    }

    #[tokio::test]
    async fn a_payload_that_streams_past_its_limit_is_cut_off() {
        let base =
            serve(vec![("/update.AppImage", "200 OK", Body::Unsized(vec![0; 200_000]))]).await;
        let client = plain_http(Limits { payload_bytes: 1000, ..Limits::APP });
        let mut received = 0;
        let error = client
            .download(&base.join("update.AppImage").expect("url"), &mut |chunk| {
                received += chunk.len();
                Ok(())
            })
            .await
            .expect_err("too large");
        assert!(
            matches!(&error, UpdateError::Network(message) if message.contains("larger than 1000 bytes")),
            "{error}"
        );
        assert!(received <= 1000, "{received} bytes reached the staging file");
    }

    #[tokio::test]
    async fn a_download_that_outlasts_its_deadline_fails() {
        let base = serve(vec![("/update.AppImage", "200 OK", Body::Stalling)]).await;
        let client =
            plain_http(Limits { download_deadline: Duration::from_millis(300), ..Limits::APP });
        let started = Instant::now();
        let error = client
            .download(&base.join("update.AppImage").expect("url"), &mut |_| Ok(()))
            .await
            .expect_err("deadline");
        assert!(matches!(error, UpdateError::Network(_)), "{error}");
        assert!(started.elapsed() < Duration::from_secs(10), "the deadline cut the stall short");
    }
}
