// Copyright (C) 2024-2026 Sjors Robroek
// SPDX-License-Identifier: AGPL-3.0-only

//! Ephemeral bounded-BFS traversal previews for panel lineage, mosaic lineage,
//! and accepted mosaic connectivity.
//!
//! Each preview runs in a `tokio::spawn`ed task, reads a single immutable
//! SQLite read watermark, and never writes any domain row, audit entry, or
//! outbox event. Progress is published via an `Arc<RwLock<TraversalState>>`.
//! Cancellation is signalled through an `Arc<AtomicBool>`.
//!
//! Results are kept in-process: nodes and edges are `Vec` inside the terminal
//! state. When the task handle is dropped (e.g. the process restarts) all
//! results are lost; callers then receive `traversal.operation_not_found`.
//!
//! Ceiling rules from the spec:
//! - Node ceiling: `maxNodes` (1–100,000); sentinel = ceiling + 1.
//! - Edge ceiling: `maxEdges` (1–2,000,000); sentinel = ceiling + 1.
//! - Depth ceiling: `maxDepth` (1–4,096); sentinel = depth > ceiling.
//! Any ceiling hit produces the typed error and no partial result.

use std::collections::{HashMap, HashSet, VecDeque};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;

use sqlx::SqlitePool;
use tokio::sync::RwLock;
use uuid::Uuid;

/// Graph kind for traversal.
#[derive(Clone, Debug, PartialEq, Eq)]
pub enum TraversalGraph {
    PanelLineage,
    MosaicLineage,
    AcceptedMosaicConnectivity,
}

/// Direction of traversal.
#[derive(Clone, Debug, PartialEq, Eq)]
pub enum TraversalDirection {
    Predecessors,
    Successors,
    Both,
}

/// Caller-controlled ceilings.
#[derive(Clone, Debug)]
pub struct TraversalLimits {
    pub max_depth: u32,
    pub max_nodes: u64,
    pub max_edges: u64,
}

impl Default for TraversalLimits {
    fn default() -> Self {
        Self {
            max_depth: 64,
            max_nodes: 10_000,
            max_edges: 50_000,
        }
    }
}

/// An entity reference node used in traversal results.
#[derive(Clone, Debug, PartialEq, Eq, Hash)]
pub struct EntityRef {
    pub entity_type: &'static str,
    /// Public UUID string.
    pub entity_id: String,
    /// Integer row id used for DB lookups.
    pub row_id: i64,
}

/// An edge in the traversal result.
#[derive(Clone, Debug)]
pub struct TraversalEdge {
    pub from_ref: EntityRef,
    pub to_ref: EntityRef,
}

/// Completed traversal node with its minimum BFS depth.
#[derive(Clone, Debug)]
pub struct TraversalNode {
    pub node_ref: EntityRef,
    pub depth: u32,
}

/// Terminal error type for traversal.
#[derive(Clone, Debug)]
pub enum TraversalError {
    NodeCeiling { max_nodes: u64 },
    EdgeCeiling { max_edges: u64 },
    DepthCeiling { max_depth: u32 },
    /// Operation was cancelled by the caller; no partial result is available.
    Cancelled,
    DbError(String),
}

/// Traversal operation state (progress + result).
#[derive(Clone, Debug, Default)]
pub struct TraversalState {
    pub phase: TraversalPhase,
    pub visited_node_count: u64,
    pub visited_edge_count: u64,
    pub frontier_count: u64,
    pub deepest_level: u32,
    /// Populated only on `Completed`.
    pub nodes: Vec<TraversalNode>,
    /// Populated only on `Completed`.
    pub edges: Vec<TraversalEdge>,
    pub terminal_error: Option<TraversalError>,
}

#[derive(Clone, Debug, Default, PartialEq, Eq)]
pub enum TraversalPhase {
    #[default]
    Queued,
    Running,
    Completed,
    Cancelled,
    Failed,
}

/// A running or completed traversal operation.
pub struct TraversalOperation {
    pub operation_id: Uuid,
    /// Captured sequence watermark (SQLite `repository_change.sequence`).
    pub read_watermark: i64,
    pub state: Arc<RwLock<TraversalState>>,
    pub cancel: Arc<AtomicBool>,
}

/// In-process registry of active traversal operations keyed by operation UUID.
///
/// An `RwLock` over a plain `HashMap` is sufficient here; there are at most a
/// few dozen concurrent previews.
pub type TraversalRegistry = Arc<RwLock<HashMap<Uuid, Arc<TraversalOperation>>>>;

pub fn new_registry() -> TraversalRegistry {
    Arc::new(RwLock::new(HashMap::new()))
}

/// Start an asynchronous BFS traversal and register it.
///
/// Returns the operation ID and initial progress immediately. The BFS runs in
/// a background task; callers poll progress via the registry.
///
/// **Does not write any DB row or audit entry.**
pub async fn start_traversal(
    registry: &TraversalRegistry,
    pool: SqlitePool,
    start_refs: Vec<EntityRef>,
    graph: TraversalGraph,
    direction: TraversalDirection,
    limits: TraversalLimits,
) -> Result<(Uuid, i64), String> {
    // Capture the current read watermark.
    let watermark: i64 = {
        let mut conn = pool.acquire().await.map_err(|e| e.to_string())?;
        let (seq,): (i64,) = sqlx::query_as("SELECT COALESCE(MAX(sequence), 0) FROM repository_change")
            .fetch_one(&mut *conn)
            .await
            .map_err(|e| e.to_string())?;
        seq
    };

    let operation_id = Uuid::new_v4();
    let state = Arc::new(RwLock::new(TraversalState {
        phase: TraversalPhase::Queued,
        ..Default::default()
    }));
    let cancel = Arc::new(AtomicBool::new(false));

    let op = Arc::new(TraversalOperation {
        operation_id,
        read_watermark: watermark,
        state: state.clone(),
        cancel: cancel.clone(),
    });

    registry.write().await.insert(operation_id, op);

    // Spawn the BFS task.
    let registry_clone = registry.clone();
    tokio::spawn(async move {
        run_bfs(
            pool,
            operation_id,
            watermark,
            start_refs,
            graph,
            direction,
            limits,
            state,
            cancel,
        )
        .await;
        // The operation stays in the registry after completion so callers can
        // retrieve results. Expiry is handled by the caller.
        let _ = registry_clone; // keep alive
    });

    Ok((operation_id, watermark))
}

/// Cancel a running traversal. Returns false when the operation is not found.
pub async fn cancel_traversal(registry: &TraversalRegistry, operation_id: Uuid) -> bool {
    let guard = registry.read().await;
    if let Some(op) = guard.get(&operation_id) {
        op.cancel.store(true, Ordering::Relaxed);
        true
    } else {
        false
    }
}

/// Get current progress snapshot.
pub async fn get_progress(
    registry: &TraversalRegistry,
    operation_id: Uuid,
) -> Option<TraversalState> {
    let guard = registry.read().await;
    if let Some(op) = guard.get(&operation_id) {
        Some(op.state.read().await.clone())
    } else {
        None
    }
}

// ── BFS implementation ────────────────────────────────────────────────────────

async fn run_bfs(
    pool: SqlitePool,
    operation_id: Uuid,
    watermark: i64,
    start_refs: Vec<EntityRef>,
    graph: TraversalGraph,
    direction: TraversalDirection,
    limits: TraversalLimits,
    state: Arc<RwLock<TraversalState>>,
    cancel: Arc<AtomicBool>,
) {
    // Transition to Running.
    {
        let mut s = state.write().await;
        s.phase = TraversalPhase::Running;
    }

    match bfs_inner(
        pool,
        watermark,
        start_refs,
        graph,
        direction,
        limits,
        state.clone(),
        cancel,
    )
    .await
    {
        Ok((nodes, edges)) => {
            let mut s = state.write().await;
            s.visited_node_count = nodes.len() as u64;
            s.visited_edge_count = edges.len() as u64;
            s.nodes = nodes;
            s.edges = edges;
            s.phase = TraversalPhase::Completed;
        }
        Err(TraversalError::Cancelled) => {
            // Phase was already set to Cancelled inside bfs_inner; preserve it.
            let _ = operation_id;
        }
        Err(TraversalError::DbError(msg)) => {
            let _ = operation_id;
            let mut s = state.write().await;
            s.terminal_error = Some(TraversalError::DbError(msg));
            s.phase = TraversalPhase::Failed;
        }
        Err(e) => {
            // Ceiling errors: surface via Failed with the typed error attached.
            let mut s = state.write().await;
            s.terminal_error = Some(e);
            s.phase = TraversalPhase::Failed;
        }
    }
}

/// BFS inner — performs the traversal, publishing progress snapshots
/// periodically. Returns the completed node and edge collections on success.
///
/// Cancellation is checked after every 256 expanded edges.
#[allow(clippy::too_many_arguments)]
async fn bfs_inner(
    pool: SqlitePool,
    watermark: i64,
    start_refs: Vec<EntityRef>,
    graph: TraversalGraph,
    direction: TraversalDirection,
    limits: TraversalLimits,
    state: Arc<RwLock<TraversalState>>,
    cancel: Arc<AtomicBool>,
) -> Result<(Vec<TraversalNode>, Vec<TraversalEdge>), TraversalError> {
    let mut conn = pool
        .acquire()
        .await
        .map_err(|e| TraversalError::DbError(e.to_string()))?;

    // Visited set: row_id → minimum depth.
    let mut visited: HashMap<i64, u32> = HashMap::new();
    let mut result_nodes: Vec<TraversalNode> = Vec::new();
    let mut result_edges: Vec<TraversalEdge> = Vec::new();
    let mut visited_edges: HashSet<(i64, i64)> = HashSet::new();

    // Initialize frontier.
    let mut frontier: VecDeque<(EntityRef, u32)> = VecDeque::new();
    for start in &start_refs {
        if visited.insert(start.row_id, 0).is_none() {
            result_nodes.push(TraversalNode { node_ref: start.clone(), depth: 0 });
            frontier.push_back((start.clone(), 0));
        }
    }

    let mut edges_since_cancel_check = 0u32;
    let mut last_progress = std::time::Instant::now();

    while let Some((current_ref, depth)) = frontier.pop_front() {
        if cancel.load(Ordering::Relaxed) {
            let mut s = state.write().await;
            s.phase = TraversalPhase::Cancelled;
            return Err(TraversalError::Cancelled);
        }

        // Fetch neighbours from DB.
        let neighbours = fetch_neighbours(
            &mut conn,
            &current_ref,
            &graph,
            &direction,
            watermark,
        )
        .await
        .map_err(|e| TraversalError::DbError(e.to_string()))?;

        for (neighbour, edge_key) in neighbours {
            // Edge ceiling check.
            if result_edges.len() as u64 >= limits.max_edges {
                return Err(TraversalError::EdgeCeiling {
                    max_edges: limits.max_edges,
                });
            }

            let edge_canonical = if edge_key.0 <= edge_key.1 {
                (edge_key.0, edge_key.1)
            } else {
                (edge_key.1, edge_key.0)
            };

            if visited_edges.insert(edge_canonical) {
                result_edges.push(TraversalEdge {
                    from_ref: current_ref.clone(),
                    to_ref: neighbour.clone(),
                });
            }

            let next_depth = depth + 1;

            // Depth ceiling check.
            if next_depth > limits.max_depth {
                return Err(TraversalError::DepthCeiling {
                    max_depth: limits.max_depth,
                });
            }

            // Node ceiling check (ceiling + 1 sentinel: request one more than
            // allowed to detect truncation).
            if !visited.contains_key(&neighbour.row_id) {
                if result_nodes.len() as u64 >= limits.max_nodes {
                    return Err(TraversalError::NodeCeiling {
                        max_nodes: limits.max_nodes,
                    });
                }
                visited.insert(neighbour.row_id, next_depth);
                result_nodes.push(TraversalNode {
                    node_ref: neighbour.clone(),
                    depth: next_depth,
                });
                frontier.push_back((neighbour, next_depth));
            }

            edges_since_cancel_check += 1;
            if edges_since_cancel_check >= 256 {
                edges_since_cancel_check = 0;
                if cancel.load(Ordering::Relaxed) {
                    let mut s = state.write().await;
                    s.phase = TraversalPhase::Cancelled;
                    return Err(TraversalError::Cancelled);
                }
            }
        }

        // Publish progress every ~500ms.
        let now = std::time::Instant::now();
        if now.duration_since(last_progress).as_millis() >= 500 {
            last_progress = now;
            let deepest = result_nodes.iter().map(|n| n.depth).max().unwrap_or(0);
            let mut s = state.write().await;
            s.visited_node_count = result_nodes.len() as u64;
            s.visited_edge_count = result_edges.len() as u64;
            s.frontier_count = frontier.len() as u64;
            s.deepest_level = deepest;
        }
    }

    Ok((result_nodes, result_edges))
}

/// Fetch direct neighbours for one node, constrained to the immutable
/// `watermark` snapshot.
///
/// Returns `(neighbour_ref, (from_row_id, to_row_id))` for each edge.
async fn fetch_neighbours(
    conn: &mut sqlx::pool::PoolConnection<sqlx::Sqlite>,
    node_ref: &EntityRef,
    graph: &TraversalGraph,
    direction: &TraversalDirection,
    watermark: i64,
) -> Result<Vec<(EntityRef, (i64, i64))>, sqlx::Error> {
    match graph {
        TraversalGraph::PanelLineage => {
            fetch_panel_lineage_neighbours(conn, node_ref, direction, watermark).await
        }
        TraversalGraph::MosaicLineage => {
            fetch_mosaic_lineage_neighbours(conn, node_ref, direction, watermark).await
        }
        TraversalGraph::AcceptedMosaicConnectivity => {
            fetch_mosaic_connectivity_neighbours(conn, node_ref, watermark).await
        }
    }
}

async fn fetch_panel_lineage_neighbours(
    conn: &mut sqlx::pool::PoolConnection<sqlx::Sqlite>,
    node_ref: &EntityRef,
    direction: &TraversalDirection,
    watermark: i64,
) -> Result<Vec<(EntityRef, (i64, i64))>, sqlx::Error> {
    let mut results = Vec::new();

    // Forward (successors): node is predecessor → fetch successors.
    if matches!(direction, TraversalDirection::Successors | TraversalDirection::Both) {
        let rows: Vec<(i64, String)> = sqlx::query_as(
            "SELECT pg.row_id, pg.public_id
             FROM panel_group_lineage pgl
             JOIN panel_group pg ON pg.row_id = pgl.successor_group_row_id
             WHERE pgl.predecessor_group_row_id = ?
               AND pgl.created_sequence <= ?",
        )
        .bind(node_ref.row_id)
        .bind(watermark)
        .fetch_all(&mut **conn)
        .await?;

        for (row_id, public_id) in rows {
            results.push((
                EntityRef { entity_type: "panel_group", entity_id: public_id, row_id },
                (node_ref.row_id, row_id),
            ));
        }
    }

    // Backward (predecessors): node is successor → fetch predecessors.
    if matches!(direction, TraversalDirection::Predecessors | TraversalDirection::Both) {
        let rows: Vec<(i64, String)> = sqlx::query_as(
            "SELECT pg.row_id, pg.public_id
             FROM panel_group_lineage pgl
             JOIN panel_group pg ON pg.row_id = pgl.predecessor_group_row_id
             WHERE pgl.successor_group_row_id = ?
               AND pgl.created_sequence <= ?",
        )
        .bind(node_ref.row_id)
        .bind(watermark)
        .fetch_all(&mut **conn)
        .await?;

        for (row_id, public_id) in rows {
            results.push((
                EntityRef { entity_type: "panel_group", entity_id: public_id, row_id },
                (row_id, node_ref.row_id),
            ));
        }
    }

    Ok(results)
}

async fn fetch_mosaic_lineage_neighbours(
    conn: &mut sqlx::pool::PoolConnection<sqlx::Sqlite>,
    node_ref: &EntityRef,
    direction: &TraversalDirection,
    watermark: i64,
) -> Result<Vec<(EntityRef, (i64, i64))>, sqlx::Error> {
    let mut results = Vec::new();

    if matches!(direction, TraversalDirection::Successors | TraversalDirection::Both) {
        let rows: Vec<(i64, String)> = sqlx::query_as(
            "SELECT m.row_id, m.public_id
             FROM mosaic_lineage ml
             JOIN mosaic m ON m.row_id = ml.successor_mosaic_row_id
             WHERE ml.predecessor_mosaic_row_id = ?
               AND ml.created_sequence <= ?",
        )
        .bind(node_ref.row_id)
        .bind(watermark)
        .fetch_all(&mut **conn)
        .await?;

        for (row_id, public_id) in rows {
            results.push((
                EntityRef { entity_type: "mosaic", entity_id: public_id, row_id },
                (node_ref.row_id, row_id),
            ));
        }
    }

    if matches!(direction, TraversalDirection::Predecessors | TraversalDirection::Both) {
        // Uses idx_mosaic_lineage_successor.
        let rows: Vec<(i64, String)> = sqlx::query_as(
            "SELECT m.row_id, m.public_id
             FROM mosaic_lineage ml
             JOIN mosaic m ON m.row_id = ml.predecessor_mosaic_row_id
             WHERE ml.successor_mosaic_row_id = ?
               AND ml.created_sequence <= ?",
        )
        .bind(node_ref.row_id)
        .bind(watermark)
        .fetch_all(&mut **conn)
        .await?;

        for (row_id, public_id) in rows {
            results.push((
                EntityRef { entity_type: "mosaic", entity_id: public_id, row_id },
                (row_id, node_ref.row_id),
            ));
        }
    }

    Ok(results)
}

/// Mosaic connectivity is undirected: traverse accepted non-stale edges between
/// panel revisions within the same mosaic revision.
///
/// Node type here is `panel_group_revision` — the unique node identifier.
async fn fetch_mosaic_connectivity_neighbours(
    conn: &mut sqlx::pool::PoolConnection<sqlx::Sqlite>,
    node_ref: &EntityRef,
    watermark: i64,
) -> Result<Vec<(EntityRef, (i64, i64))>, sqlx::Error> {
    // Undirected: find edges where this node is either left or right endpoint,
    // constrained to accepted (non-stale) evidence at or before watermark.
    let rows: Vec<(i64, String, i64, i64)> = sqlx::query_as(
        "SELECT
            CASE
                WHEN mee.left_panel_revision_row_id = ? THEN mee.right_panel_revision_row_id
                ELSE mee.left_panel_revision_row_id
            END AS neighbour_row_id,
            pgr.public_id AS neighbour_public_id,
            mee.left_panel_revision_row_id,
            mee.right_panel_revision_row_id
         FROM mosaic_edge_evidence mee
         JOIN panel_group_revision pgr ON pgr.row_id = CASE
             WHEN mee.left_panel_revision_row_id = ? THEN mee.right_panel_revision_row_id
             ELSE mee.left_panel_revision_row_id
         END
         WHERE (mee.left_panel_revision_row_id = ? OR mee.right_panel_revision_row_id = ?)
           AND mee.created_sequence <= ?
           AND NOT EXISTS (
               SELECT 1 FROM mosaic_edge_invalidation inv
               WHERE inv.edge_evidence_row_id = mee.row_id
                 AND inv.created_sequence <= ?
           )",
    )
    .bind(node_ref.row_id)
    .bind(node_ref.row_id)
    .bind(node_ref.row_id)
    .bind(node_ref.row_id)
    .bind(watermark)
    .bind(watermark)
    .fetch_all(&mut **conn)
    .await?;

    Ok(rows
        .into_iter()
        .map(|(neighbour_row_id, public_id, left, right)| {
            (
                EntityRef {
                    entity_type: "panel_group_revision",
                    entity_id: public_id,
                    row_id: neighbour_row_id,
                },
                (left, right),
            )
        })
        .collect())
}
