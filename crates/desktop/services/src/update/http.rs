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

/// The HTTPS client. Follows redirects, as GitHub's `releases/latest/download`
/// URLs need, and uses the system proxy and certificate store.
pub struct Http {
    client: reqwest::Client,
}

impl Http {
    pub fn new(user_agent: &str) -> Result<Self, UpdateError> {
        let client = reqwest::Client::builder()
            .user_agent(user_agent)
            .connect_timeout(STALL_TIMEOUT)
            .read_timeout(STALL_TIMEOUT)
            .build()
            .map_err(|error| {
                UpdateError::Config(format!("cannot build the HTTP client: {error}"))
            })?;
        Ok(Self { client })
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
            Ok(Some(response.bytes().await.map_err(network)?.to_vec()))
        })
    }

    fn download<'a>(
        &'a self,
        url: &'a Url,
        sink: &'a mut ChunkSink<'_>,
    ) -> BoxFuture<'a, Result<(), UpdateError>> {
        Box::pin(async move {
            let mut response = self
                .client
                .get(url.clone())
                .header(ACCEPT, "application/octet-stream")
                .send()
                .await
                .map_err(network)?
                .error_for_status()
                .map_err(network)?;
            while let Some(chunk) = response.chunk().await.map_err(network)? {
                sink(&chunk)?;
            }
            Ok(())
        })
    }
}

fn network(error: reqwest::Error) -> UpdateError {
    UpdateError::Network(error.without_url().to_string())
}

#[cfg(test)]
mod tests {
    //! The HTTP client against a local server speaking plain HTTP/1.1.

    use reqwest::Url;
    use tokio::io::{AsyncReadExt as _, AsyncWriteExt as _};
    use tokio::net::TcpListener;

    use super::{Http, Source};
    use crate::update::UpdateError;

    /// Serve `routes` (path, status line, body) until the test ends; any
    /// other path is a 404. Returns the server's base URL.
    async fn serve(routes: Vec<(&'static str, &'static str, Vec<u8>)>) -> Url {
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
                let (status, body) = routes
                    .iter()
                    .find(|(route, _, _)| *route == path)
                    .map_or(("404 Not Found", &[][..]), |(_, status, body)| (*status, &body[..]));
                let head = format!(
                    "HTTP/1.1 {status}\r\nContent-Length: {}\r\nConnection: close\r\n\r\n",
                    body.len()
                );
                stream.write_all(head.as_bytes()).await.expect("write head");
                stream.write_all(body).await.expect("write body");
                stream.shutdown().await.expect("close");
            }
        });
        base
    }

    fn http() -> Http {
        Http::new("PlateVault/test").expect("client")
    }

    #[tokio::test]
    async fn the_manifest_body_is_returned() {
        let base =
            serve(vec![("/latest.json", "200 OK", b"{\"version\":\"0.7.0\"}".to_vec())]).await;
        let manifest =
            http().manifest(&base.join("latest.json").expect("url")).await.expect("fetch");
        assert_eq!(manifest.as_deref(), Some(&b"{\"version\":\"0.7.0\"}"[..]));
    }

    #[tokio::test]
    async fn no_content_means_no_update() {
        let base = serve(vec![("/latest.json", "204 No Content", Vec::new())]).await;
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
        let base = serve(vec![("/update.AppImage", "200 OK", payload.clone())]).await;
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
}
