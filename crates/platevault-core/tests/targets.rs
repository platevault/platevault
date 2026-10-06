//! Offline target catalog, provider adapter and association evidence, exercised
//! against the real bundled seed and a loopback SIMBAD TAP endpoint.

#[path = "../src/targets.rs"]
mod targets;

use std::io::{Read, Write};
use std::net::TcpListener;
use std::sync::atomic::{AtomicUsize, Ordering};
use std::sync::{Arc, LazyLock};

use platevault_core::{
    AssociationState, CaptureMetadata, EvidenceItem, LibraryError, Provenance, SkyCoordinates,
    TargetAlias, TargetCandidate, TargetCone,
};
use simbad_resolver::identity::{namespace, target_id_from_designation};
use simbad_resolver::{RANK_EXACT, RANK_PREFIX};
use targets::{
    assess_target, normalize_alias, user_target, ObjectType, OfflineTargetResolver, SimbadConfig,
    SimbadTargetResolver, TargetIndex, TargetQuery, UserTargetInput, ASSOCIATION_RULE, ICRS_FRAME,
    TARGET_ID_NAMESPACE,
};

const SEED_JSON: &[u8] =
    include_bytes!(concat!(env!("CARGO_MANIFEST_DIR"), "/../../assets/seed/seed.json"));
const M31_RA: f64 = 10.684_708;
const M31_DEC: f64 = 41.268_75;

static INDEX: LazyLock<TargetIndex> =
    LazyLock::new(|| TargetIndex::bundled().expect("bundled seed loads"));

fn index() -> &'static TargetIndex {
    &INDEX
}

fn text(query: &str, limit: usize) -> TargetQuery {
    TargetQuery { text: Some(query.to_owned()), cone: None, limit }
}

fn cone(ra_deg: f64, dec_deg: f64, radius_deg: f64) -> TargetCone {
    TargetCone { ra_deg, dec_deg, radius_deg }
}

fn seed(query: &str) -> TargetCandidate {
    index().search(&text(query, 1), &[]).unwrap().remove(0).candidate
}

fn invalid(result: Result<impl std::fmt::Debug, LibraryError>) -> bool {
    result.is_err_and(|error| matches!(error, LibraryError::InvalidInput(_)))
}

fn separation(a: (f64, f64), b: (f64, f64)) -> f64 {
    let eq = |(ra, dec): (f64, f64)| {
        skymath::Equatorial::j2000(
            skymath::Angle::from_degrees(ra),
            skymath::Angle::from_degrees(dec),
        )
        .unwrap()
    };
    skymath::separation(eq(a), eq(b)).degrees()
}

#[test]
fn bundled_seed_reports_the_pinned_dataset_and_its_real_counts() {
    let provenance = index().provenance();
    assert_eq!(
        provenance.sha256,
        "aa442354ca1f36cd0f56acea209ae19390c479e9affe94e10fd135d09313365a"
    );
    assert_eq!(provenance.dataset, "bundled-seed/v1/sha256:aa442354ca1f36cd");
    assert_eq!(provenance.version, 1);
    assert_eq!(provenance.generated_at, "2026-07-14T08:05:52.025066447Z");
    assert!(provenance.source.starts_with("SIMBAD TAP (CDS"), "{}", provenance.source);
    assert_eq!((provenance.target_count, provenance.alias_count), (13_073, 16_460));

    let reloaded = TargetIndex::bundled().unwrap();
    let ngc7000 = seed("NGC 7000");
    assert_eq!(ngc7000.id, target_id_from_designation(&namespace(TARGET_ID_NAMESPACE), "NGC 7000"));
    assert_eq!(reloaded.candidate(ngc7000.id), Some(ngc7000));
}

#[test]
fn known_designations_and_aliases_resolve_offline_with_seed_provenance() {
    let dataset = Provenance::Seed { dataset: index().provenance().dataset.clone() };
    for (query, designation, alias) in [
        ("NGC7000", "NGC 7000", "NGC 7000"),
        ("north america nebula", "NGC 7000", "North America Nebula"),
        ("LBN 373", "NGC 7000", "LBN 373"),
        ("M31", "M 31", "M 31"),
        ("ngc-224", "M 31", "NGC 224"),
        ("Andromeda Galaxy", "M 31", "Andromeda Galaxy"),
    ] {
        let hits = index().search(&text(query, 5), &[]).unwrap();
        let top = &hits[0];
        assert_eq!(top.candidate.designation, designation, "{query}");
        assert_eq!(
            (top.rank, top.matched_alias.as_deref()),
            (Some(RANK_EXACT), Some(alias)),
            "{query}"
        );
        assert_eq!(top.candidate.provenance, dataset, "{query}");
        assert!(top.candidate.aliases.iter().all(|a| a.provenance == dataset), "{query}");
        assert_eq!(top.separation_deg, None);
    }

    let ngc7000 = seed("ngc 7000");
    assert_eq!(ngc7000.provider_id.as_deref(), Some("59950"));
    assert_eq!(ngc7000.object_type, "open_cluster");
    let coordinates = ngc7000.coordinates.unwrap();
    assert_eq!(coordinates.frame, ICRS_FRAME);
    assert!(
        (coordinates.ra_deg - 314.695_833).abs() < 1e-6
            && (coordinates.dec_deg - 44.33).abs() < 1e-9
    );

    let prefix = index().search(&text("north amer", 3), &[]).unwrap();
    assert_eq!(prefix[0].candidate.designation, "NGC 7000");
    assert_eq!(
        (prefix[0].rank, prefix[0].matched_alias.as_deref()),
        (Some(RANK_PREFIX), Some("North America"))
    );
}

#[test]
fn typed_cone_returns_exactly_the_seed_objects_inside_it_nearest_first() {
    let center = cone(M31_RA, M31_DEC, 1.0);
    let query = TargetQuery { text: None, cone: Some(center), limit: 1_000 };
    let hits = index().search(&query, &[]).unwrap();

    let seed: serde_json::Value = serde_json::from_slice(SEED_JSON).unwrap();
    let inside: Vec<&str> = seed["entries"]
        .as_array()
        .unwrap()
        .iter()
        .filter(|e| {
            let position = (e["ra_deg"].as_f64().unwrap(), e["dec_deg"].as_f64().unwrap());
            separation((M31_RA, M31_DEC), position) <= 1.0
        })
        .map(|e| e["primary_designation"].as_str().unwrap())
        .collect();
    let mut found: Vec<&str> = hits.iter().map(|h| h.candidate.designation.as_str()).collect();
    assert_eq!(found[0], "M 31");
    assert!(found.contains(&"M 32") && found.contains(&"M 110"), "{found:?}");
    found.sort_unstable();
    let mut expected = inside.clone();
    expected.sort_unstable();
    assert_eq!(found, expected);

    for hit in &hits {
        let c = hit.candidate.coordinates.as_ref().unwrap();
        let independent = separation((M31_RA, M31_DEC), (c.ra_deg, c.dec_deg));
        assert!(
            (hit.separation_deg.unwrap() - independent).abs() < 1e-9,
            "{}",
            hit.candidate.designation
        );
        assert_eq!(hit.rank, None);
    }
    assert!(hits.windows(2).all(|w| w[0].separation_deg <= w[1].separation_deg));

    let far = TargetQuery { text: Some("NGC 7000".into()), cone: Some(center), limit: 5 };
    assert!(index().search(&far, &[]).unwrap().is_empty());
    let near = TargetQuery {
        text: Some("NGC 7000".into()),
        cone: Some(cone(314.7, 44.33, 0.5)),
        limit: 5,
    };
    let near = index().search(&near, &[]).unwrap();
    assert_eq!(near.len(), 1);
    assert_eq!(
        (near[0].rank, near[0].candidate.designation.as_str()),
        (Some(RANK_EXACT), "NGC 7000")
    );
    assert!(near[0].separation_deg.unwrap() < 0.01);

    for bad in [
        cone(M31_RA, 95.0, 1.0),
        cone(360.0, 0.0, 1.0),
        cone(M31_RA, M31_DEC, -1.0),
        cone(f64::NAN, 0.0, 1.0),
    ] {
        assert!(invalid(
            index().search(&TargetQuery { text: None, cone: Some(bad), limit: 5 }, &[])
        ));
    }
}

#[test]
fn queries_without_searchable_input_are_refused() {
    assert!(invalid(index().search(&text("M31", 0), &[])));
    assert!(invalid(index().search(&text("  ", 5), &[])));
    assert!(invalid(index().search(&text("!!!", 5), &[])));
    assert!(invalid(index().search(&TargetQuery { text: None, cone: None, limit: 5 }, &[])));
    assert_eq!(normalize_alias("NGC-7000"), "ngc 7000");
    assert_eq!(text("NGC-7000", 1).alias_key().as_deref(), Some("ngc 7000"));
    assert_eq!(text("--", 1).alias_key(), None);
}

#[test]
fn explicit_user_targets_stay_distinct_from_seed_records() {
    let input = UserTargetInput {
        designation: " M 31 ".into(),
        aliases: vec!["My Andromeda".into(), "m31".into()],
        common_name: None,
        object_type: ObjectType::Galaxy,
        coordinates: Some(SkyCoordinates { ra_deg: 10.7, dec_deg: 41.3, frame: ICRS_FRAME.into() }),
    };
    let user = user_target(&input).unwrap();
    assert_eq!(
        (user.designation.as_str(), &user.provenance, user.provider_id.as_deref()),
        ("M 31", &Provenance::User, None)
    );
    let keys: Vec<(&str, &str)> =
        user.aliases.iter().map(|a| (a.normalized.as_str(), a.kind.as_str())).collect();
    assert_eq!(keys, [("m 31", "designation"), ("my andromeda", "user")]);
    assert!(user.aliases.iter().all(|a| a.provenance == Provenance::User));

    let seed_m31 = seed("M 31");
    assert_ne!(user.id, seed_m31.id);
    let hits = index().search(&text("m 31", 10), std::slice::from_ref(&user)).unwrap();
    let exact: Vec<&Provenance> = hits
        .iter()
        .filter(|h| h.rank == Some(RANK_EXACT))
        .map(|h| &h.candidate.provenance)
        .collect();
    assert_eq!(exact.len(), 2);
    assert!(exact.contains(&&Provenance::User) && exact.contains(&&seed_m31.provenance));
    let own = index().search(&text("my andromeda", 5), std::slice::from_ref(&user)).unwrap();
    assert_eq!(own.len(), 1);
    assert_eq!(own[0].candidate, user);

    let unknown_position =
        user_target(&UserTargetInput { coordinates: None, ..input.clone() }).unwrap();
    assert_eq!(unknown_position.coordinates, None);
    let in_cone = TargetQuery { text: None, cone: Some(cone(M31_RA, M31_DEC, 0.5)), limit: 50 };
    let cone_hits = index().search(&in_cone, std::slice::from_ref(&unknown_position)).unwrap();
    assert!(cone_hits.iter().all(|h| h.candidate.id != unknown_position.id));

    for bad in [
        UserTargetInput { designation: "  ".into(), ..input.clone() },
        UserTargetInput { aliases: vec!["!!".into()], ..input.clone() },
        UserTargetInput {
            coordinates: Some(SkyCoordinates { ra_deg: 10.7, dec_deg: 41.3, frame: "fk4".into() }),
            ..input.clone()
        },
        UserTargetInput {
            coordinates: Some(SkyCoordinates {
                ra_deg: 10.7,
                dec_deg: 95.0,
                frame: ICRS_FRAME.into(),
            }),
            ..input
        },
    ] {
        assert!(invalid(user_target(&bad)));
    }
}

// ── Loopback SIMBAD TAP ──────────────────────────────────────────────────────

const M31_BASIC: &str = "oid\tmain_id\tra\tdec\totype_txt\tV\n\
    1575544\t\"M  31\"\t10.6847083\t41.26875\t\"G\"\t3.44\n";
const M31_IDENT: &str = "id\n\"M   31\"\n\"NGC   224\"\n\"NAME Andromeda Galaxy\"\n";
const EMPTY_BASIC: &str = "oid\tmain_id\tra\tdec\totype_txt\tV\n";
const AMBIGUOUS_BASIC: &str = "oid\tmain_id\tra\tdec\totype_txt\tV\n\
    1575544\t\"M  31\"\t10.6847083\t41.26875\t\"G\"\t3.44\n\
    999999\t\"Some Other\"\t11.0\t42.0\t\"G\"\t\n";

struct Tap {
    endpoint: String,
    requests: Arc<AtomicUsize>,
}

/// Minimal HTTP/1.1 TAP endpoint: the alias query gets `ident`, anything else `basic`.
fn serve(basic: &'static str, ident: &'static str) -> Tap {
    let listener = TcpListener::bind("127.0.0.1:0").unwrap();
    let endpoint = format!("http://{}/simbad/sim-tap/sync", listener.local_addr().unwrap());
    let requests = Arc::new(AtomicUsize::new(0));
    let counter = Arc::clone(&requests);
    std::thread::spawn(move || {
        for stream in listener.incoming() {
            let Ok(mut stream) = stream else { continue };
            let mut request = Vec::new();
            let mut buffer = [0_u8; 4096];
            while !request.windows(4).any(|w| w == b"\r\n\r\n") {
                match stream.read(&mut buffer) {
                    Ok(0) | Err(_) => break,
                    Ok(n) => request.extend_from_slice(&buffer[..n]),
                }
            }
            counter.fetch_add(1, Ordering::SeqCst);
            let head = String::from_utf8_lossy(&request);
            let body = if head.contains("FROM+ident") { ident } else { basic };
            let _ = write!(
                stream,
                "HTTP/1.1 200 OK\r\nContent-Type: text/tab-separated-values\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{body}",
                body.len()
            );
        }
    });
    Tap { endpoint, requests }
}

fn simbad(endpoint: &str) -> SimbadTargetResolver {
    SimbadTargetResolver::simbad(&SimbadConfig::from_settings(endpoint, 5)).unwrap()
}

fn kind(error: &LibraryError) -> String {
    error.response(None, None).kind
}

#[tokio::test]
async fn provider_candidate_keeps_simbad_provenance_and_shares_the_seed_identity() {
    let tap = serve(M31_BASIC, M31_IDENT);
    let resolver = simbad(&tap.endpoint);
    let candidate = resolver.resolve("M31").await.unwrap();
    assert_eq!(tap.requests.load(Ordering::SeqCst), 2, "basic row plus alias round-trip");

    let provider = Provenance::Provider { name: "simbad".into(), id: Some("1575544".into()) };
    assert_eq!((candidate.designation.as_str(), &candidate.provenance), ("M 31", &provider));
    assert_eq!(candidate.provider_id.as_deref(), Some("1575544"));
    assert_eq!(candidate.object_type, "galaxy");
    assert_eq!(
        candidate.coordinates,
        Some(SkyCoordinates { ra_deg: 10.684_708_3, dec_deg: 41.268_75, frame: ICRS_FRAME.into() })
    );
    let mut aliases: Vec<(&str, &str)> =
        candidate.aliases.iter().map(|a| (a.normalized.as_str(), a.kind.as_str())).collect();
    aliases.sort_unstable();
    assert_eq!(
        aliases,
        [("andromeda galaxy", "common_name"), ("m 31", "designation"), ("ngc 224", "designation")]
    );
    assert!(candidate.aliases.iter().all(|a: &TargetAlias| a.provenance == provider));

    let seed_m31 = seed("M31");
    assert_eq!(candidate.id, seed_m31.id);
    let hits = index().search(&text("ngc 224", 10), std::slice::from_ref(&candidate)).unwrap();
    let exact: Vec<&Provenance> = hits
        .iter()
        .filter(|h| h.rank == Some(RANK_EXACT))
        .map(|h| &h.candidate.provenance)
        .collect();
    assert_eq!(
        exact,
        [&provider],
        "a saved provider record shadows the seed record it shares an id with"
    );

    assert_eq!(resolver.resolve("M 31").await.unwrap(), candidate);
    assert_eq!(tap.requests.load(Ordering::SeqCst), 2, "facade answers a repeat from its cache");
}

#[tokio::test]
async fn missing_or_failing_providers_fail_explicitly_while_local_search_works() {
    let offline = OfflineTargetResolver::offline().unwrap().resolve("M31").await.unwrap_err();
    assert_eq!(kind(&offline), "provider_unavailable");

    let port = TcpListener::bind("127.0.0.1:0").unwrap().local_addr().unwrap().port();
    let refused = simbad(&format!("http://127.0.0.1:{port}/simbad/sim-tap/sync"))
        .resolve("M31")
        .await
        .unwrap_err();
    assert_eq!(kind(&refused), "provider_unavailable");

    let unknown = serve(EMPTY_BASIC, EMPTY_BASIC);
    let missing = simbad(&unknown.endpoint).resolve("Not An Object").await.unwrap_err();
    assert_eq!(kind(&missing), "not_found");
    let ambiguous = serve(AMBIGUOUS_BASIC, M31_IDENT);
    let several = simbad(&ambiguous.endpoint).resolve("M31").await.unwrap_err();
    assert_eq!(kind(&several), "invalid_input");
    assert!(invalid(simbad(&unknown.endpoint).resolve(" -- ").await));
    assert!(matches!(
        SimbadTargetResolver::simbad(&SimbadConfig::from_settings("not a url", 1)),
        Err(LibraryError::ProviderUnavailable(_))
    ));

    assert_eq!(seed("M31").designation, "M 31");
}

// ── Association evidence ─────────────────────────────────────────────────────

/// A light frame through a 400 mm / 3.76 µm / 6248×4176 train (inscribed radius ≈ 1.12°).
fn light(object: Option<&str>, wcs: Option<(f64, f64)>) -> CaptureMetadata {
    CaptureMetadata {
        object: object.map(str::to_owned),
        wcs_ra_deg: wcs.map(|p| p.0),
        wcs_dec_deg: wcs.map(|p| p.1),
        focal_length_mm: Some(400.0),
        pixel_size_um: Some(3.76),
        width: Some(6248),
        height: Some(4176),
        ..CaptureMetadata::default()
    }
}

fn header_pointed(object: Option<&str>, ra_deg: f64, dec_deg: f64) -> CaptureMetadata {
    CaptureMetadata { ra_deg: Some(ra_deg), dec_deg: Some(dec_deg), ..light(object, None) }
}

fn has(evidence: &[EvidenceItem], wanted: &EvidenceItem) -> bool {
    evidence.contains(wanted)
}

fn unknown(field: &str) -> EvidenceItem {
    EvidenceItem::Unknown { field: field.into() }
}

fn coordinates_qualified(evidence: &[EvidenceItem]) -> Option<bool> {
    evidence.iter().find_map(|e| match e {
        EvidenceItem::Coordinates { qualified, .. } => Some(*qualified),
        _ => None,
    })
}

#[test]
fn agreeing_alias_and_framed_coordinates_on_every_frame_suggest() {
    let m31 = seed("M31");
    let frames =
        [light(Some("M31"), Some((M31_RA, M31_DEC))), header_pointed(Some("m 31"), 10.70, 41.25)];
    let assessment = assess_target(&m31, &frames);
    assert_eq!(assessment.state, AssociationState::Suggested);
    assert_eq!(assessment.provenance, Provenance::Inferred { rule: ASSOCIATION_RULE.into() });
    assert!(has(
        &assessment.evidence,
        &EvidenceItem::Alias { normalized: "m 31".into(), agrees: true }
    ));
    assert_eq!(coordinates_qualified(&assessment.evidence), Some(true));
    assert_eq!(assessment.evidence.len(), 2, "{:?}", assessment.evidence);
}

#[test]
fn a_label_or_a_separation_alone_never_suggests() {
    let m31 = seed("M31");
    let label_only = assess_target(&m31, &[light(Some("M31"), None)]);
    assert_eq!(label_only.state, AssociationState::NeedsReview);
    assert!(has(&label_only.evidence, &unknown("pointing")));
    assert_eq!(coordinates_qualified(&label_only.evidence), None);

    let angle_only = assess_target(&m31, &[light(None, Some((M31_RA, M31_DEC)))]);
    assert_eq!(angle_only.state, AssociationState::NeedsReview);
    assert!(has(&angle_only.evidence, &unknown("OBJECT")));
    assert_eq!(coordinates_qualified(&angle_only.evidence), Some(true));

    let candidates = index().candidates_for_frames(&[light(None, Some((M31_RA, M31_DEC)))], &[]);
    assert!(candidates.iter().any(|a| a.candidate.designation == "M 31"));
    assert!(candidates.iter().all(|a| a.state == AssociationState::NeedsReview));
}

#[test]
fn missing_object_and_coordinates_stay_unresolved() {
    let m31 = seed("M31");
    let bare = CaptureMetadata::default();
    let assessment = assess_target(&m31, std::slice::from_ref(&bare));
    assert_eq!(assessment.state, AssociationState::Unresolved);
    assert!(
        has(&assessment.evidence, &unknown("OBJECT"))
            && has(&assessment.evidence, &unknown("pointing"))
    );
    assert_eq!(assess_target(&m31, &[]).state, AssociationState::Unresolved);
    assert!(index().candidates_for_frames(&[bare], &[]).is_empty());
}

#[test]
fn conflicting_partial_or_unqualified_evidence_needs_review() {
    let m31 = seed("M31");
    let at_m31 = Some((M31_RA, M31_DEC));

    let conflict = assess_target(&m31, &[light(Some("M31"), at_m31), light(Some("M 33"), at_m31)]);
    assert_eq!(conflict.state, AssociationState::NeedsReview);
    assert!(has(
        &conflict.evidence,
        &EvidenceItem::Conflict {
            field: "OBJECT".into(),
            values: vec!["M31".into(), "M 33".into()]
        }
    ));

    let partial = assess_target(&m31, &[light(Some("M31"), at_m31), light(None, at_m31)]);
    assert_eq!(partial.state, AssociationState::NeedsReview);

    let narrow = CaptureMetadata {
        focal_length_mm: Some(2000.0),
        width: Some(1000),
        height: Some(1000),
        ..light(Some("M110"), at_m31)
    };
    let outside = assess_target(&seed("M110"), &[narrow]);
    assert_eq!(outside.state, AssociationState::NeedsReview);
    assert_eq!(coordinates_qualified(&outside.evidence), Some(false));

    let no_optics = CaptureMetadata { focal_length_mm: None, ..light(Some("M31"), at_m31) };
    let unmeasured = assess_target(&m31, &[no_optics]);
    assert_eq!(unmeasured.state, AssociationState::NeedsReview);
    assert!(has(&unmeasured.evidence, &unknown("field_of_view")));

    let positionless = user_target(&UserTargetInput {
        designation: "M 31".into(),
        aliases: Vec::new(),
        common_name: None,
        object_type: ObjectType::Galaxy,
        coordinates: None,
    })
    .unwrap();
    let no_target_position = assess_target(&positionless, &[light(Some("M31"), at_m31)]);
    assert_eq!(no_target_position.state, AssociationState::NeedsReview);
    assert!(has(&no_target_position.evidence, &unknown("target_coordinates")));
}

#[test]
fn session_candidates_put_the_qualified_target_first_without_inventing_others() {
    let at_ngc7000 = Some((314.695_833, 44.33));
    let frames =
        [light(Some("North America Nebula"), at_ngc7000), light(Some("NGC 7000"), at_ngc7000)];
    let candidates = index().candidates_for_frames(&frames, &[]);
    assert_eq!(candidates[0].candidate.designation, "NGC 7000");
    assert_eq!(candidates[0].state, AssociationState::Suggested, "{:?}", candidates[0].evidence);
    assert!(
        candidates[1..].iter().all(|a| a.state == AssociationState::NeedsReview),
        "{candidates:?}"
    );

    let pelican = Some((312.75, 44.366_667));
    let mixed = [light(Some("NGC 7000"), pelican), light(Some("IC 5070"), pelican)];
    let candidates = index().candidates_for_frames(&mixed, &[]);
    let states: Vec<(&str, &AssociationState)> =
        candidates.iter().map(|a| (a.candidate.designation.as_str(), &a.state)).collect();
    assert!(states.contains(&("NGC 7000", &AssociationState::NeedsReview)), "{states:?}");
    assert!(states.contains(&("IC 5070", &AssociationState::NeedsReview)), "{states:?}");
    assert!(candidates.iter().all(|a| a.state != AssociationState::Suggested), "{states:?}");
}
