//! Composed library target search over a real SQLite catalog and the real
//! bundled seed index: saved-target caching must never hide committed catalog
//! state from a consumer.

use std::io::{Read, Write};
use std::net::TcpListener;
use std::path::Path;
use std::sync::Arc;

use persistence_library::Catalog;
use platevault_core::library::Library;
use platevault_core::targets::{
    normalize_alias, user_target, ObjectType, SimbadConfig, TargetQuery, TargetSearchHit,
    UserTargetInput, ICRS_FRAME,
};
use platevault_core::{Provenance, SkyCoordinates, TargetAlias, TargetCandidate, TargetCone};
use simbad_resolver::{RANK_EXACT, RANK_SUBSTRING};
use uuid::Uuid;

const M31_SEED: (f64, f64) = (10.684_708, 41.268_75);
const M31_PROVIDER: (f64, f64) = (12.5, 38.0);

async fn open(database: &Path) -> Arc<Library> {
    Library::open(database, None).await.unwrap()
}

fn text(query: &str, limit: usize) -> TargetQuery {
    TargetQuery { text: Some(query.to_owned()), cone: None, limit }
}

fn cone((ra_deg, dec_deg): (f64, f64), radius_deg: f64) -> TargetQuery {
    TargetQuery { text: None, cone: Some(TargetCone { ra_deg, dec_deg, radius_deg }), limit: 100 }
}

fn ids(hits: &[TargetSearchHit]) -> Vec<Uuid> {
    hits.iter().map(|hit| hit.candidate.id).collect()
}

fn hit(hits: &[TargetSearchHit], id: Uuid) -> Option<&TargetSearchHit> {
    hits.iter().find(|hit| hit.candidate.id == id)
}

fn user(designation: &str, aliases: &[&str]) -> TargetCandidate {
    user_target(&UserTargetInput {
        designation: designation.to_owned(),
        aliases: aliases.iter().map(|alias| (*alias).to_owned()).collect(),
        common_name: None,
        object_type: ObjectType::Other,
        coordinates: None,
    })
    .unwrap()
}

#[tokio::test]
async fn warm_search_ranks_a_saved_partial_alias_from_beyond_the_first_catalog_page() {
    let temp = tempfile::tempdir().unwrap();
    let library = open(&temp.path().join("library.sqlite")).await;
    assert!(library.search_targets(&text("pvq", 2_000)).await.unwrap().is_empty());

    for index in 0..1_000 {
        let bulk = user(&format!("Bulk {index:04}"), &[&format!("Pvq Bulk {index:04}")]);
        library.catalog().save_target(&bulk, None).await.unwrap();
    }
    let warm = library.search_targets(&text("pvq", 2_000)).await.unwrap();
    assert_eq!(warm.len(), 1_000, "one full catalog page is visible to the warm search");

    let late = user("Zeta Late", &["Pvq", "Pvq Late Witness Nebula"]);
    library.catalog().save_target(&late, None).await.unwrap();
    let first_page = library.catalog().list_targets(0, 1_000).await.unwrap();
    assert!(
        first_page.iter().all(|record| record.candidate.id != late.id),
        "fixture: the late target must sort onto the second catalog page"
    );

    let partial = library.search_targets(&text("late witness", 10)).await.unwrap();
    assert_eq!(ids(&partial), [late.id]);
    assert_eq!(partial[0].rank, Some(RANK_SUBSTRING));
    assert_eq!(partial[0].matched_alias.as_deref(), Some("Pvq Late Witness Nebula"));
    assert_eq!(partial[0].candidate.provenance, Provenance::User);

    let best = library.search_targets(&text("pvq", 1)).await.unwrap();
    assert_eq!(ids(&best), [late.id], "global ranking puts the page-two exact alias first");
    assert_eq!(best[0].rank, Some(RANK_EXACT));
    assert_eq!(library.search_targets(&text("pvq", 2_000)).await.unwrap().len(), 1_001);
}

// ── Loopback SIMBAD TAP ──────────────────────────────────────────────────────

/// Serve one canned SIMBAD TAP answer: the alias query gets `ident`, any other query `basic`.
fn serve_tap(basic: &'static str, ident: &'static str) -> String {
    let listener = TcpListener::bind("127.0.0.1:0").unwrap();
    let endpoint = format!("http://{}/simbad/sim-tap/sync", listener.local_addr().unwrap());
    std::thread::spawn(move || {
        for stream in listener.incoming() {
            let Ok(mut stream) = stream else { continue };
            let mut request = Vec::new();
            let mut buffer = [0_u8; 4096];
            while !request.windows(4).any(|window| window == b"\r\n\r\n") {
                match stream.read(&mut buffer) {
                    Ok(0) | Err(_) => break,
                    Ok(read) => request.extend_from_slice(&buffer[..read]),
                }
            }
            let body = if String::from_utf8_lossy(&request).contains("FROM+ident") {
                ident
            } else {
                basic
            };
            let _ = write!(
                stream,
                "HTTP/1.1 200 OK\r\nContent-Type: text/tab-separated-values\r\n\
                 Content-Length: {}\r\nConnection: close\r\n\r\n{body}",
                body.len()
            );
        }
    });
    endpoint
}

#[tokio::test]
async fn saved_provider_and_edited_records_replace_the_warm_seed_record_with_the_same_id() {
    let endpoint = serve_tap(
        "oid\tmain_id\tra\tdec\totype_txt\tV\n1575544\t\"M  31\"\t12.5\t38.0\t\"G\"\t3.44\n",
        "id\n\"M   31\"\n\"NGC   224\"\n",
    );
    let temp = tempfile::tempdir().unwrap();
    let config = SimbadConfig::from_settings(endpoint, 5);
    let library = Library::open(&temp.path().join("library.sqlite"), Some(&config)).await.unwrap();

    let warm = library.search_targets(&text("Andromeda Galaxy", 5)).await.unwrap();
    let seed = warm.iter().find(|hit| hit.candidate.designation == "M 31").unwrap();
    let m31 = seed.candidate.id;
    assert!(matches!(seed.candidate.provenance, Provenance::Seed { .. }));
    assert!(ids(&library.search_targets(&cone(M31_SEED, 0.2)).await.unwrap()).contains(&m31));

    let provider = library.resolve_target("M31").await.unwrap();
    assert_eq!(provider.id, m31, "provider and seed share the designation identity");
    let saved = library.catalog().save_target(&provider, None).await.unwrap();

    let renamed = library.search_targets(&text("Andromeda Galaxy", 50)).await.unwrap();
    assert!(hit(&renamed, m31).is_none(), "the replaced seed alias no longer matches");
    let by_provider_alias = library.search_targets(&text("NGC 224", 5)).await.unwrap();
    assert_eq!(by_provider_alias[0].candidate.id, m31);
    assert_eq!(by_provider_alias[0].candidate.provenance, provider.provenance);
    assert_eq!(ids(&by_provider_alias).iter().filter(|id| **id == m31).count(), 1);
    assert!(hit(&library.search_targets(&cone(M31_SEED, 0.2)).await.unwrap(), m31).is_none());
    let at_provider = library.search_targets(&cone(M31_PROVIDER, 0.2)).await.unwrap();
    assert_eq!(hit(&at_provider, m31).unwrap().candidate.provenance, provider.provenance);

    let mut edited = saved.candidate.clone();
    edited.coordinates =
        Some(SkyCoordinates { ra_deg: 15.0, dec_deg: 35.0, frame: ICRS_FRAME.into() });
    edited.aliases.push(TargetAlias {
        text: "My Andromeda".into(),
        normalized: normalize_alias("My Andromeda"),
        kind: "user".into(),
        provenance: Provenance::User,
    });
    library.catalog().save_target(&edited, Some(saved.decision_revision)).await.unwrap();

    assert!(hit(&library.search_targets(&cone(M31_PROVIDER, 0.2)).await.unwrap(), m31).is_none());
    let moved = library.search_targets(&cone((15.0, 35.0), 0.2)).await.unwrap();
    assert_eq!(hit(&moved, m31).unwrap().candidate, edited);
    let own = library.search_targets(&text("my andromeda", 5)).await.unwrap();
    assert_eq!(ids(&own), [m31]);
}

#[tokio::test]
async fn a_saved_user_override_of_a_seed_id_drops_every_seed_alias_it_removed() {
    let temp = tempfile::tempdir().unwrap();
    let library = open(&temp.path().join("library.sqlite")).await;
    let seed = library.search_targets(&text("M 31", 1)).await.unwrap().remove(0).candidate;
    let removed: Vec<String> = seed
        .aliases
        .iter()
        .filter(|alias| alias.normalized != "m 31")
        .map(|alias| alias.text.clone())
        .collect();
    assert!(removed.len() >= 4, "fixture: M 31 carries several seed aliases: {removed:?}");
    for alias in &removed {
        let warm = library.search_targets(&text(alias, 50)).await.unwrap();
        assert!(hit(&warm, seed.id).is_some(), "fixture: seed alias {alias:?} matches before");
    }

    let alias = |text: &str| TargetAlias {
        text: text.to_owned(),
        normalized: normalize_alias(text),
        kind: "user".into(),
        provenance: Provenance::User,
    };
    let mut user_override = seed.clone();
    user_override.provenance = Provenance::User;
    user_override.provider_id = None;
    user_override.aliases = vec![alias("M 31"), alias("Pv Home Galaxy")];
    library.catalog().save_target(&user_override, None).await.unwrap();

    for removed_alias in &removed {
        let after = library.search_targets(&text(removed_alias, 50)).await.unwrap();
        assert!(
            hit(&after, seed.id).is_none(),
            "removed seed alias {removed_alias:?} still matches"
        );
    }
    let andromeda = library.search_targets(&text("andromeda", 200)).await.unwrap();
    assert!(hit(&andromeda, seed.id).is_none(), "no removed prefix alias reaches the record");
    let kept = library.search_targets(&text("M 31", 50)).await.unwrap();
    assert_eq!(ids(&kept).iter().filter(|id| **id == seed.id).count(), 1);
    let kept = hit(&kept, seed.id).unwrap();
    assert_eq!(kept.candidate, user_override);
    assert_eq!(
        (kept.candidate.designation.as_str(), kept.candidate.object_type.as_str()),
        ("M 31", "galaxy")
    );
    let own = library.search_targets(&text("pv home galaxy", 5)).await.unwrap();
    assert_eq!(ids(&own), [seed.id]);
    assert_eq!(own[0].candidate.provenance, Provenance::User);
}

#[tokio::test]
async fn a_changed_seed_fact_replaces_the_bundled_record_in_a_warm_search() {
    let temp = tempfile::tempdir().unwrap();
    let library = open(&temp.path().join("library.sqlite")).await;
    let bundled = library.search_targets(&text("NGC 7000", 1)).await.unwrap().remove(0).candidate;
    library.catalog().record_seed_target(&bundled).await.unwrap();

    assert!(library.search_targets(&text("pv seed refresh", 5)).await.unwrap().is_empty());
    let warm = library.search_targets(&text("North America Nebula", 5)).await.unwrap();
    assert_eq!(warm[0].candidate.id, bundled.id);

    let dataset = Provenance::Seed { dataset: "bundled-seed/v2/refreshed".into() };
    let mut refreshed = bundled.clone();
    refreshed.provenance = dataset.clone();
    refreshed.aliases.retain(|alias| alias.normalized != "north america nebula");
    refreshed.aliases.push(TargetAlias {
        text: "Pv Seed Refresh".into(),
        normalized: normalize_alias("Pv Seed Refresh"),
        kind: "designation".into(),
        provenance: dataset.clone(),
    });
    library.catalog().record_seed_target(&refreshed).await.unwrap();

    let found = library.search_targets(&text("pv seed refresh", 5)).await.unwrap();
    assert_eq!(ids(&found), [bundled.id]);
    assert_eq!(found[0].candidate.provenance, dataset);
    let dropped = library.search_targets(&text("North America Nebula", 50)).await.unwrap();
    assert!(hit(&dropped, bundled.id).is_none(), "the refreshed fact shadows the bundled alias");
}

#[tokio::test]
async fn restart_reads_the_durable_catalog_instead_of_a_remembered_cache() {
    let temp = tempfile::tempdir().unwrap();
    let database = temp.path().join("library.sqlite");
    let alpha = user("Pv Alpha", &[]);
    let library = open(&database).await;
    let saved = library.catalog().save_target(&alpha, None).await.unwrap();
    assert_eq!(ids(&library.search_targets(&text("pv alpha", 5)).await.unwrap()), [alpha.id]);
    drop(library);

    let catalog = Catalog::open(&database).await.unwrap();
    let mut renamed = saved.candidate;
    renamed.aliases = vec![TargetAlias {
        text: "Pv Gamma".into(),
        normalized: normalize_alias("Pv Gamma"),
        kind: "user".into(),
        provenance: Provenance::User,
    }];
    catalog.save_target(&renamed, Some(saved.decision_revision)).await.unwrap();
    catalog.close().await.unwrap();

    let reopened = open(&database).await;
    assert!(reopened.search_targets(&text("pv alpha", 5)).await.unwrap().is_empty());
    let gamma = reopened.search_targets(&text("pv gamma", 5)).await.unwrap();
    assert_eq!(ids(&gamma), [alpha.id]);
    assert_eq!(gamma[0].candidate, renamed);
}

#[tokio::test]
async fn separate_catalogs_at_the_same_generation_never_share_saved_targets() {
    let temp = tempfile::tempdir().unwrap();
    let first = open(&temp.path().join("first.sqlite")).await;
    let second = open(&temp.path().join("second.sqlite")).await;
    let alpha = user("Pv Alpha", &[]);
    let beta = user("Pv Beta", &[]);
    first.catalog().save_target(&alpha, None).await.unwrap();
    second.catalog().save_target(&beta, None).await.unwrap();
    assert_eq!(
        first.catalog().target_generation().await.unwrap(),
        second.catalog().target_generation().await.unwrap(),
        "fixture: both catalogs report the same generation"
    );

    assert_eq!(ids(&first.search_targets(&text("pv", 10)).await.unwrap()), [alpha.id]);
    assert_eq!(ids(&second.search_targets(&text("pv", 10)).await.unwrap()), [beta.id]);
    assert_eq!(ids(&first.search_targets(&text("pv", 10)).await.unwrap()), [alpha.id]);
}
