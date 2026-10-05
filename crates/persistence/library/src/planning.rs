// Copyright (C) 2024-2026 Sjors Robroek
// SPDX-License-Identifier: AGPL-3.0-only

//! Planning records (spec 072): saved sites, the default site, Planned marks,
//! reminder subscriptions and delivery identities, as Tier 1 decisions on the
//! catalog's single serialized writer. Every write is one `BEGIN IMMEDIATE`
//! transaction that checks its expected revisions and every referenced record,
//! and changes only the planning tables. A default-site change or a site edit
//! moves the affected subscriptions to `needs_reconfirmation` in the same
//! transaction. Windows and upcoming reminders are never stored here.

use platevault_model::{
    BlockReason, DefaultSiteSaved, DeliveryState, LibraryError, ObservingSite, PlanCriteria,
    PlanningSettings, PlanningSites, ReminderDelivery, ReminderInput, ReminderSubscription,
    Revision, SiteInput, SiteSaved, SubscriptionState, TargetPlan, WindowKey,
};
use serde::de::DeserializeOwned;
use serde::Serialize;
use sqlx::sqlite::{SqliteConnection, SqliteRow};
use sqlx::{Connection, Row};
use time::format_description::well_known::Rfc3339;
use time::{Date, OffsetDateTime, UtcOffset};
use uuid::Uuid;

use super::{
    conflict, db_revision, from_json, load_target, next_revision, now, parse_uuid, revision,
    to_json, Catalog, Result, MAX_PAGE,
};

/// The identity a Conflict on the planning settings names.
pub const PLANNING_SETTINGS_ID: Uuid = Uuid::from_u128(0x7a3c_51e0_0072_5000_8000_0000_0000_0001);

/// An activation's subscription write: the default site, its revision and the
/// settings revision the user confirmed, with explicit criteria and lead time.
#[derive(Clone, Debug, PartialEq)]
pub struct SubscriptionWrite {
    pub target_id: Uuid,
    pub site_id: Uuid,
    pub site_revision: Revision,
    pub settings_revision: Revision,
    pub criteria: PlanCriteria,
    pub lead_minutes: u32,
    /// The current subscription revision; `None` when none exists yet.
    pub expected: Option<Revision>,
    /// `Enabled`, or `Blocked` with its reason.
    pub state: SubscriptionState,
    pub block_reason: Option<BlockReason>,
}

/// A window identity to take before its reminder is submitted.
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct DeliveryClaim {
    pub key: WindowKey,
    pub window_end_utc: OffsetDateTime,
    pub night: Date,
    pub due_at: OffsetDateTime,
}

/// What the notification adapter answered for a claimed identity.
#[derive(Clone, Debug, Eq, PartialEq)]
pub enum DeliveryOutcome {
    Submitted,
    Failed { reason: String },
}

const SITE_SQL: &str = "SELECT id, name, latitude_deg, longitude_deg, elevation_m, time_zone, \
                        revision, created_at, updated_at FROM observing_sites";
const SUBSCRIPTION_SQL: &str = "SELECT s.target_id, s.site_id, o.name AS site_name, \
     s.site_revision, s.settings_revision, s.criteria, s.lead_minutes, s.state, s.block_reason, \
     s.revision, s.activated_at, s.updated_at \
     FROM reminder_subscriptions s JOIN observing_sites o ON o.id = s.site_id";
const DELIVERY_SQL: &str = "SELECT d.target_id, d.site_id, o.name AS site_name, \
     d.window_start_utc, d.window_end_utc, d.night, d.due_at, d.state, d.reason, d.created_at, \
     d.updated_at FROM reminder_deliveries d JOIN observing_sites o ON o.id = d.site_id";

/// Which subscriptions a planning write moves to `needs_reconfirmation`.
enum Reconfirm {
    OnSite(Uuid),
    OffSite(Uuid),
    All,
}

impl Catalog {
    /// Create a site at revision 1, or edit one at its expected revision. An
    /// edit moves the site's enabled and blocked subscriptions to
    /// `needs_reconfirmation`. The zone name is validated by the caller against
    /// the bundled time-zone database.
    ///
    /// # Errors
    /// `InvalidInput` for invalid fields or a trimmed name another site holds;
    /// `NotFound` for an unknown site; `Conflict` with the current revision for
    /// a stale or missing expected revision. Nothing is written on failure.
    pub async fn save_site(
        &self,
        id: Option<Uuid>,
        expected: Option<Revision>,
        input: &SiteInput,
    ) -> Result<SiteSaved> {
        input.validate()?;
        let name = input.name.trim();
        let saved = write_txn!(self, |conn| {
            let current: Option<i64> = match id {
                Some(id) => {
                    let current =
                        sqlx::query_scalar("SELECT revision FROM observing_sites WHERE id = ?1")
                            .bind(id.to_string())
                            .fetch_optional(&mut *conn)
                            .await?;
                    if current.is_none() {
                        return Err(LibraryError::NotFound(format!("site {id}")));
                    }
                    current
                }
                None => None,
            };
            let id = id.unwrap_or_else(Uuid::new_v4);
            let next = next_revision(id, current, expected, "site")?;
            let holder: Option<String> =
                sqlx::query_scalar("SELECT id FROM observing_sites WHERE name = ?1 AND id != ?2")
                    .bind(name)
                    .bind(id.to_string())
                    .fetch_optional(&mut *conn)
                    .await?;
            if let Some(holder) = holder {
                return Err(LibraryError::InvalidInput(format!(
                    "name {name:?} already names site {holder}"
                )));
            }
            let at = now()?;
            sqlx::query(
                "INSERT INTO observing_sites (id, name, latitude_deg, longitude_deg, elevation_m, \
                 time_zone, revision, created_at, updated_at) \
                 VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?8) \
                 ON CONFLICT (id) DO UPDATE SET name = excluded.name, \
                 latitude_deg = excluded.latitude_deg, longitude_deg = excluded.longitude_deg, \
                 elevation_m = excluded.elevation_m, time_zone = excluded.time_zone, \
                 revision = excluded.revision, updated_at = excluded.updated_at",
            )
            .bind(id.to_string())
            .bind(name)
            .bind(input.latitude_deg)
            .bind(input.longitude_deg)
            .bind(input.elevation_m)
            .bind(&input.time_zone)
            .bind(db_revision(next)?)
            .bind(&at)
            .execute(&mut *conn)
            .await?;
            let needs_reconfirmation = if next > 1 {
                reconfirm(conn, Reconfirm::OnSite(id), &at).await?
            } else {
                Vec::new()
            };
            SiteSaved { site: load_site(conn, id).await?, needs_reconfirmation }
        });
        Ok(saved)
    }

    /// Every saved site by name, with the default site and settings revision.
    ///
    /// # Errors
    /// `PersistenceFailure` when the catalog cannot be read.
    pub async fn list_sites(&self) -> Result<PlanningSites> {
        let mut conn = self.reader().await?;
        let rows = sqlx::query(sqlx::AssertSqlSafe(format!("{SITE_SQL} ORDER BY name, id")))
            .fetch_all(&mut *conn)
            .await?;
        let sites = rows.iter().map(site_row).collect::<Result<Vec<_>>>()?;
        let settings = load_settings(&mut conn).await?;
        Ok(PlanningSites {
            sites,
            default_site_id: settings.default_site_id,
            settings_revision: settings.revision,
        })
    }

    /// # Errors
    /// `NotFound` for an unknown site.
    pub async fn site(&self, id: Uuid) -> Result<ObservingSite> {
        let mut conn = self.reader().await?;
        load_site(&mut conn, id).await
    }

    /// Set or clear the default site at the expected settings revision (0 when
    /// never saved). Setting it moves enabled and blocked subscriptions on
    /// other sites, and clearing it moves all of them, to
    /// `needs_reconfirmation`.
    ///
    /// # Errors
    /// `Conflict` naming [`PLANNING_SETTINGS_ID`] for a stale revision;
    /// `NotFound` for an unknown site. Nothing is written on failure.
    pub async fn set_default_site(
        &self,
        site: Option<Uuid>,
        expected: Revision,
    ) -> Result<DefaultSiteSaved> {
        let saved = write_txn!(self, |conn| {
            let settings = load_settings(conn).await?;
            if settings.revision != expected {
                return Err(conflict(PLANNING_SETTINGS_ID, settings.revision));
            }
            if let Some(site) = site {
                load_site(conn, site).await?;
            }
            let next = settings.revision + 1;
            let at = now()?;
            sqlx::query(
                "INSERT INTO planning_settings (id, default_site_id, revision, updated_at) \
                 VALUES (1, ?1, ?2, ?3) ON CONFLICT (id) DO UPDATE SET \
                 default_site_id = excluded.default_site_id, revision = excluded.revision, \
                 updated_at = excluded.updated_at",
            )
            .bind(site.map(|site| site.to_string()))
            .bind(db_revision(next)?)
            .bind(&at)
            .execute(&mut *conn)
            .await?;
            let scope = site.map_or(Reconfirm::All, Reconfirm::OffSite);
            let needs_reconfirmation = reconfirm(conn, scope, &at).await?;
            DefaultSiteSaved {
                settings: PlanningSettings { default_site_id: site, revision: next },
                needs_reconfirmation,
            }
        });
        Ok(saved)
    }

    /// The Planned mark of a saved Target; not Planned at revision 0 when none
    /// was written.
    ///
    /// # Errors
    /// `NotFound` for an unknown Target.
    pub async fn target_plan(&self, target: Uuid) -> Result<TargetPlan> {
        let mut conn = self.reader().await?;
        load_target(&mut conn, target).await?;
        load_plan(&mut conn, target).await
    }

    /// Mark or unmark a saved Target as Planned at the expected mark revision.
    /// The Target record and its decision revision stay unchanged.
    ///
    /// # Errors
    /// `NotFound` for an unknown Target; `Conflict` naming the Target with the
    /// current mark revision for a stale one.
    pub async fn set_target_planned(
        &self,
        target: Uuid,
        planned: bool,
        expected: Revision,
    ) -> Result<TargetPlan> {
        let plan = write_txn!(self, |conn| {
            load_target(conn, target).await?;
            let current = load_plan(conn, target).await?.revision;
            if current != expected {
                return Err(conflict(target, current));
            }
            sqlx::query(
                "INSERT INTO target_plans (target_id, planned, revision, updated_at) \
                 VALUES (?1, ?2, ?3, ?4) ON CONFLICT (target_id) DO UPDATE SET \
                 planned = excluded.planned, revision = excluded.revision, \
                 updated_at = excluded.updated_at",
            )
            .bind(target.to_string())
            .bind(planned)
            .bind(db_revision(current + 1)?)
            .bind(now()?)
            .execute(&mut *conn)
            .await?;
            load_plan(conn, target).await?
        });
        Ok(plan)
    }

    /// Commit an activation as `enabled`, or `blocked` with its reason, only
    /// while the named site is the default site at the confirmed site and
    /// settings revisions.
    ///
    /// # Errors
    /// `InvalidInput` for invalid criteria or lead time, a state other than
    /// enabled or blocked-with-reason, or no default site (naming
    /// `defaultSite`); `NotFound` for an unknown Target or site; `Conflict`
    /// naming [`PLANNING_SETTINGS_ID`] when the site is not the default or the
    /// settings revision moved, naming the site when its revision moved, and
    /// naming the Target for a stale subscription revision. Nothing is written
    /// on failure.
    pub async fn put_reminder_subscription(
        &self,
        write: &SubscriptionWrite,
    ) -> Result<ReminderSubscription> {
        ReminderInput {
            target_id: write.target_id,
            criteria: write.criteria,
            lead_minutes: write.lead_minutes,
        }
        .validate()?;
        if !matches!(
            (write.state, write.block_reason),
            (SubscriptionState::Enabled, None) | (SubscriptionState::Blocked, Some(_))
        ) {
            return Err(LibraryError::InvalidInput(format!(
                "activation commits enabled, or blocked with a reason, not {:?} with {:?}",
                write.state, write.block_reason
            )));
        }
        let subscription = write_txn!(self, |conn| {
            load_target(conn, write.target_id).await?;
            let settings = load_settings(conn).await?;
            let Some(default) = settings.default_site_id else {
                return Err(LibraryError::InvalidInput(
                    "defaultSite: no default site is set; reminders use the default site".into(),
                ));
            };
            if default != write.site_id || settings.revision != write.settings_revision {
                return Err(conflict(PLANNING_SETTINGS_ID, settings.revision));
            }
            let site = load_site(conn, write.site_id).await?;
            if site.revision != write.site_revision {
                return Err(conflict(site.id, site.revision));
            }
            let current: Option<i64> = sqlx::query_scalar(
                "SELECT revision FROM reminder_subscriptions WHERE target_id = ?1",
            )
            .bind(write.target_id.to_string())
            .fetch_optional(&mut *conn)
            .await?;
            let next =
                next_revision(write.target_id, current, write.expected, "reminder subscription")?;
            let at = now()?;
            sqlx::query(
                "INSERT INTO reminder_subscriptions (target_id, site_id, site_revision, \
                 settings_revision, criteria, lead_minutes, state, block_reason, revision, \
                 activated_at, updated_at) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?10) \
                 ON CONFLICT (target_id) DO UPDATE SET site_id = excluded.site_id, \
                 site_revision = excluded.site_revision, \
                 settings_revision = excluded.settings_revision, criteria = excluded.criteria, \
                 lead_minutes = excluded.lead_minutes, state = excluded.state, \
                 block_reason = excluded.block_reason, revision = excluded.revision, \
                 activated_at = excluded.activated_at, updated_at = excluded.updated_at",
            )
            .bind(write.target_id.to_string())
            .bind(write.site_id.to_string())
            .bind(db_revision(write.site_revision)?)
            .bind(db_revision(write.settings_revision)?)
            .bind(to_json(&write.criteria)?)
            .bind(write.lead_minutes)
            .bind(label(write.state)?)
            .bind(write.block_reason.map(label).transpose()?)
            .bind(db_revision(next)?)
            .bind(&at)
            .execute(&mut *conn)
            .await?;
            load_subscription(conn, write.target_id).await?
        });
        Ok(subscription)
    }

    /// Disable a subscription, block it with a reason, or mark it for
    /// reconfirmation, at its expected revision. Only activation enables.
    ///
    /// # Errors
    /// `InvalidInput` for `Enabled`, a blocked state without a reason or a
    /// reason on another state; `NotFound` for no subscription; `Conflict`
    /// naming the Target for a stale revision.
    pub async fn set_subscription_state(
        &self,
        target: Uuid,
        expected: Revision,
        state: SubscriptionState,
        reason: Option<BlockReason>,
    ) -> Result<ReminderSubscription> {
        let valid = match state {
            SubscriptionState::Enabled => false,
            SubscriptionState::Blocked => reason.is_some(),
            SubscriptionState::Disabled | SubscriptionState::NeedsReconfirmation => {
                reason.is_none()
            }
        };
        if !valid {
            return Err(LibraryError::InvalidInput(format!(
                "a subscription cannot move to {state:?} with {reason:?}; only activation enables"
            )));
        }
        let subscription = write_txn!(self, |conn| {
            let current: Option<i64> = sqlx::query_scalar(
                "SELECT revision FROM reminder_subscriptions WHERE target_id = ?1",
            )
            .bind(target.to_string())
            .fetch_optional(&mut *conn)
            .await?;
            let next = next_revision(target, current, Some(expected), "reminder subscription")?;
            sqlx::query(
                "UPDATE reminder_subscriptions SET state = ?2, block_reason = ?3, revision = ?4, \
                 updated_at = ?5 WHERE target_id = ?1",
            )
            .bind(target.to_string())
            .bind(label(state)?)
            .bind(reason.map(label).transpose()?)
            .bind(db_revision(next)?)
            .bind(now()?)
            .execute(&mut *conn)
            .await?;
            load_subscription(conn, target).await?
        });
        Ok(subscription)
    }

    /// The Target's subscription, if one was ever activated.
    ///
    /// # Errors
    /// `PersistenceFailure` when the catalog cannot be read.
    pub async fn reminder_subscription(
        &self,
        target: Uuid,
    ) -> Result<Option<ReminderSubscription>> {
        let mut conn = self.reader().await?;
        let row =
            sqlx::query(sqlx::AssertSqlSafe(format!("{SUBSCRIPTION_SQL} WHERE s.target_id = ?1")))
                .bind(target.to_string())
                .fetch_optional(&mut *conn)
                .await?;
        row.as_ref().map(subscription_row).transpose()
    }

    /// Subscriptions in activation order, optionally only those in `state`.
    ///
    /// # Errors
    /// `PersistenceFailure` when the catalog cannot be read.
    pub async fn reminder_subscriptions(
        &self,
        state: Option<SubscriptionState>,
    ) -> Result<Vec<ReminderSubscription>> {
        let mut conn = self.reader().await?;
        let rows = sqlx::query(sqlx::AssertSqlSafe(format!(
            "{SUBSCRIPTION_SQL} WHERE ?1 IS NULL OR s.state = ?1 ORDER BY s.activated_at, s.target_id"
        )))
        .bind(state.map(label).transpose()?)
        .fetch_all(&mut *conn)
        .await?;
        rows.iter().map(subscription_row).collect()
    }

    /// Take a window identity as `sending` before its reminder is submitted.
    /// Returns false, writing nothing, when the identity was ever claimed or the
    /// Target's subscription is no longer enabled at that site.
    ///
    /// # Errors
    /// `PersistenceFailure` when the claim cannot be committed.
    pub async fn claim_reminder_delivery(&self, claim: &DeliveryClaim) -> Result<bool> {
        let claimed = write_txn!(self, |conn| {
            let at = now()?;
            sqlx::query(
                "INSERT INTO reminder_deliveries (target_id, site_id, window_start_utc, \
                 window_end_utc, night, due_at, state, reason, created_at, updated_at) \
                 SELECT ?1, ?2, ?3, ?4, ?5, ?6, 'sending', NULL, ?7, ?7 \
                 WHERE EXISTS (SELECT 1 FROM reminder_subscriptions WHERE target_id = ?1 \
                 AND site_id = ?2 AND state = 'enabled') \
                 ON CONFLICT (target_id, site_id, window_start_utc) DO NOTHING",
            )
            .bind(claim.key.target_id().to_string())
            .bind(claim.key.site_id().to_string())
            .bind(utc_text(claim.key.start_utc())?)
            .bind(utc_text(claim.window_end_utc)?)
            .bind(night_text(claim.night)?)
            .bind(utc_text(claim.due_at)?)
            .bind(&at)
            .execute(&mut *conn)
            .await?
            .rows_affected()
                == 1
        });
        Ok(claimed)
    }

    /// Record what the adapter answered for a `sending` identity.
    ///
    /// # Errors
    /// `NotFound` for an unclaimed identity; `InvalidInput` when it is not
    /// `sending`, because a claimed identity is never resubmitted.
    pub async fn finish_reminder_delivery(
        &self,
        key: &WindowKey,
        outcome: &DeliveryOutcome,
    ) -> Result<ReminderDelivery> {
        let (state, reason) = match outcome {
            DeliveryOutcome::Submitted => (DeliveryState::Submitted, None),
            DeliveryOutcome::Failed { reason } => (DeliveryState::Failed, Some(reason.as_str())),
        };
        let delivery = write_txn!(self, |conn| {
            let current: Option<String> = sqlx::query_scalar(
                "SELECT state FROM reminder_deliveries \
                 WHERE target_id = ?1 AND site_id = ?2 AND window_start_utc = ?3",
            )
            .bind(key.target_id().to_string())
            .bind(key.site_id().to_string())
            .bind(utc_text(key.start_utc())?)
            .fetch_optional(&mut *conn)
            .await?;
            let Some(current) = current else {
                return Err(LibraryError::NotFound(format!("reminder delivery {key}")));
            };
            if current != "sending" {
                return Err(LibraryError::InvalidInput(format!(
                    "reminder delivery {key} is {current}; a claimed identity is never resubmitted"
                )));
            }
            sqlx::query(
                "UPDATE reminder_deliveries SET state = ?4, reason = ?5, updated_at = ?6 \
                 WHERE target_id = ?1 AND site_id = ?2 AND window_start_utc = ?3",
            )
            .bind(key.target_id().to_string())
            .bind(key.site_id().to_string())
            .bind(utc_text(key.start_utc())?)
            .bind(label(state)?)
            .bind(reason)
            .bind(now()?)
            .execute(&mut *conn)
            .await?;
            let row = sqlx::query(sqlx::AssertSqlSafe(format!(
                "{DELIVERY_SQL} WHERE d.target_id = ?1 AND d.site_id = ?2 AND d.window_start_utc = ?3"
            )))
            .bind(key.target_id().to_string())
            .bind(key.site_id().to_string())
            .bind(utc_text(key.start_utc())?)
            .fetch_one(&mut *conn)
            .await?;
            delivery_row(&row)?
        });
        Ok(delivery)
    }

    /// Delivery records, newest first; a zero `limit` reads one full page.
    ///
    /// # Errors
    /// `PersistenceFailure` when the catalog cannot be read.
    pub async fn reminder_deliveries(
        &self,
        offset: u32,
        limit: u32,
    ) -> Result<Vec<ReminderDelivery>> {
        let mut conn = self.reader().await?;
        let rows = sqlx::query(sqlx::AssertSqlSafe(format!(
            "{DELIVERY_SQL} ORDER BY d.id DESC LIMIT ?1 OFFSET ?2"
        )))
        .bind(i64::from(if limit == 0 { MAX_PAGE } else { limit.min(MAX_PAGE) }))
        .bind(i64::from(offset))
        .fetch_all(&mut *conn)
        .await?;
        rows.iter().map(delivery_row).collect()
    }
}

/// At catalog open, an identity left `sending` by an interrupted run becomes
/// `uncertain` and is never sent again.
pub async fn recover_sending(conn: &mut SqliteConnection) -> Result<()> {
    let mut txn = conn.begin_with("BEGIN IMMEDIATE").await?;
    sqlx::query(
        "UPDATE reminder_deliveries SET state = 'uncertain', updated_at = ?1 WHERE state = 'sending'",
    )
    .bind(now()?)
    .execute(&mut *txn)
    .await?;
    txn.commit().await?;
    Ok(())
}

async fn reconfirm(conn: &mut SqliteConnection, scope: Reconfirm, at: &str) -> Result<Vec<Uuid>> {
    const MOVE: &str = "UPDATE reminder_subscriptions SET state = 'needs_reconfirmation', \
                        block_reason = NULL, revision = revision + 1, updated_at = ?1 \
                        WHERE state IN ('enabled', 'blocked')";
    let (sql, site) = match scope {
        Reconfirm::OnSite(site) => {
            (format!("{MOVE} AND site_id = ?2 RETURNING target_id"), Some(site))
        }
        Reconfirm::OffSite(site) => {
            (format!("{MOVE} AND site_id != ?2 RETURNING target_id"), Some(site))
        }
        Reconfirm::All => (format!("{MOVE} RETURNING target_id"), None),
    };
    let mut query = sqlx::query_scalar::<_, String>(sqlx::AssertSqlSafe(sql)).bind(at);
    if let Some(site) = site {
        query = query.bind(site.to_string());
    }
    let mut moved = query
        .fetch_all(&mut *conn)
        .await?
        .iter()
        .map(|id| parse_uuid(id))
        .collect::<Result<Vec<_>>>()?;
    moved.sort_unstable();
    Ok(moved)
}

async fn load_site(conn: &mut SqliteConnection, id: Uuid) -> Result<ObservingSite> {
    let row = sqlx::query(sqlx::AssertSqlSafe(format!("{SITE_SQL} WHERE id = ?1")))
        .bind(id.to_string())
        .fetch_optional(&mut *conn)
        .await?
        .ok_or_else(|| LibraryError::NotFound(format!("site {id}")))?;
    site_row(&row)
}

async fn load_settings(conn: &mut SqliteConnection) -> Result<PlanningSettings> {
    let row = sqlx::query("SELECT default_site_id, revision FROM planning_settings WHERE id = 1")
        .fetch_optional(&mut *conn)
        .await?;
    let Some(row) = row else {
        return Ok(PlanningSettings { default_site_id: None, revision: 0 });
    };
    let default: Option<String> = row.try_get("default_site_id")?;
    Ok(PlanningSettings {
        default_site_id: default.as_deref().map(parse_uuid).transpose()?,
        revision: revision(row.try_get("revision")?)?,
    })
}

async fn load_plan(conn: &mut SqliteConnection, target: Uuid) -> Result<TargetPlan> {
    let row =
        sqlx::query("SELECT planned, revision, updated_at FROM target_plans WHERE target_id = ?1")
            .bind(target.to_string())
            .fetch_optional(&mut *conn)
            .await?;
    let Some(row) = row else {
        return Ok(TargetPlan { target_id: target, planned: false, revision: 0, updated_at: None });
    };
    Ok(TargetPlan {
        target_id: target,
        planned: row.try_get("planned")?,
        revision: revision(row.try_get("revision")?)?,
        updated_at: Some(row.try_get("updated_at")?),
    })
}

async fn load_subscription(
    conn: &mut SqliteConnection,
    target: Uuid,
) -> Result<ReminderSubscription> {
    let row =
        sqlx::query(sqlx::AssertSqlSafe(format!("{SUBSCRIPTION_SQL} WHERE s.target_id = ?1")))
            .bind(target.to_string())
            .fetch_one(&mut *conn)
            .await?;
    subscription_row(&row)
}

fn site_row(row: &SqliteRow) -> Result<ObservingSite> {
    Ok(ObservingSite {
        id: parse_uuid(&row.try_get::<String, _>("id")?)?,
        name: row.try_get("name")?,
        latitude_deg: row.try_get("latitude_deg")?,
        longitude_deg: row.try_get("longitude_deg")?,
        elevation_m: row.try_get("elevation_m")?,
        time_zone: row.try_get("time_zone")?,
        revision: revision(row.try_get("revision")?)?,
        created_at: row.try_get("created_at")?,
        updated_at: row.try_get("updated_at")?,
    })
}

fn subscription_row(row: &SqliteRow) -> Result<ReminderSubscription> {
    let state: SubscriptionState = parse_label(&row.try_get::<String, _>("state")?)?;
    let block_reason: Option<BlockReason> = row
        .try_get::<Option<String>, _>("block_reason")?
        .as_deref()
        .map(parse_label)
        .transpose()?;
    let lead: i64 = row.try_get("lead_minutes")?;
    Ok(ReminderSubscription {
        target_id: parse_uuid(&row.try_get::<String, _>("target_id")?)?,
        site_id: parse_uuid(&row.try_get::<String, _>("site_id")?)?,
        site_name: row.try_get("site_name")?,
        site_revision: revision(row.try_get("site_revision")?)?,
        settings_revision: revision(row.try_get("settings_revision")?)?,
        criteria: from_json(&row.try_get::<String, _>("criteria")?)?,
        lead_minutes: u32::try_from(lead)
            .map_err(|_| LibraryError::PersistenceFailure(format!("corrupt lead time {lead}")))?,
        state,
        block_reason,
        actions: match (state, block_reason) {
            (SubscriptionState::Blocked, Some(reason)) => reason.actions(),
            _ => Vec::new(),
        },
        revision: revision(row.try_get("revision")?)?,
        activated_at: row.try_get("activated_at")?,
        updated_at: row.try_get("updated_at")?,
    })
}

fn delivery_row(row: &SqliteRow) -> Result<ReminderDelivery> {
    let target_id = parse_uuid(&row.try_get::<String, _>("target_id")?)?;
    let site_id = parse_uuid(&row.try_get::<String, _>("site_id")?)?;
    let window_start_utc = parse_utc(&row.try_get::<String, _>("window_start_utc")?)?;
    Ok(ReminderDelivery {
        window_key: WindowKey::new(target_id, site_id, window_start_utc)
            .map_err(|error| LibraryError::PersistenceFailure(error.to_string()))?,
        target_id,
        site_id,
        site_name: row.try_get("site_name")?,
        window_start_utc,
        window_end_utc: parse_utc(&row.try_get::<String, _>("window_end_utc")?)?,
        night: parse_night(&row.try_get::<String, _>("night")?)?,
        due_at: parse_utc(&row.try_get::<String, _>("due_at")?)?,
        state: parse_label(&row.try_get::<String, _>("state")?)?,
        reason: row.try_get("reason")?,
        created_at: row.try_get("created_at")?,
        updated_at: row.try_get("updated_at")?,
    })
}

/// The snake-case wire label of a shared-model enum.
fn label<T: Serialize>(value: T) -> Result<String> {
    match serde_json::to_value(value) {
        Ok(serde_json::Value::String(text)) => Ok(text),
        _ => Err(LibraryError::PersistenceFailure("enum without a text label".into())),
    }
}

fn parse_label<T: DeserializeOwned>(text: &str) -> Result<T> {
    serde_json::from_value(serde_json::Value::String(text.into())).map_err(|error| {
        LibraryError::PersistenceFailure(format!("corrupt label {text:?}: {error}"))
    })
}

fn utc_text(at: OffsetDateTime) -> Result<String> {
    at.to_offset(UtcOffset::UTC)
        .format(&Rfc3339)
        .map_err(|error| LibraryError::PersistenceFailure(error.to_string()))
}

fn parse_utc(text: &str) -> Result<OffsetDateTime> {
    OffsetDateTime::parse(text, &Rfc3339).map_err(|error| {
        LibraryError::PersistenceFailure(format!("corrupt instant {text:?}: {error}"))
    })
}

const NIGHT_FORMAT: &[time::format_description::BorrowedFormatItem<'static>] =
    time::macros::format_description!("[year]-[month]-[day]");

fn night_text(night: Date) -> Result<String> {
    night.format(NIGHT_FORMAT).map_err(|error| LibraryError::PersistenceFailure(error.to_string()))
}

fn parse_night(text: &str) -> Result<Date> {
    Date::parse(text, NIGHT_FORMAT).map_err(|error| {
        LibraryError::PersistenceFailure(format!("corrupt night {text:?}: {error}"))
    })
}

#[cfg(test)]
mod tests {
    use platevault_model::{Darkness, MoonCriterion, Provenance, SkyCoordinates, TargetCandidate};
    use time::macros::{date, datetime};

    use super::*;

    fn site_input(name: String) -> SiteInput {
        SiteInput {
            name,
            latitude_deg: 52.09,
            longitude_deg: 5.12,
            elevation_m: Some(5.0),
            time_zone: "Europe/Amsterdam".into(),
        }
    }

    fn candidate() -> TargetCandidate {
        TargetCandidate {
            id: Uuid::new_v4(),
            designation: "NGC 7000".into(),
            aliases: Vec::new(),
            common_name: None,
            object_type: "nebula".into(),
            coordinates: Some(SkyCoordinates {
                ra_deg: 314.75,
                dec_deg: 44.33,
                frame: "icrs".into(),
            }),
            provenance: Provenance::User,
            provider_id: None,
        }
    }

    #[tokio::test]
    async fn a_full_disk_fails_planning_writes_with_nothing_persisted() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("catalog.sqlite");
        let catalog = Catalog::open(&path).await.unwrap();
        let target = catalog.save_target(&candidate(), None).await.unwrap();
        let site =
            catalog.save_site(None, None, &site_input("Backyard".into())).await.unwrap().site;
        catalog.set_default_site(Some(site.id), 0).await.unwrap();
        let write = SubscriptionWrite {
            target_id: target.candidate.id,
            site_id: site.id,
            site_revision: 1,
            settings_revision: 1,
            criteria: PlanCriteria {
                min_altitude_deg: 30.0,
                darkness: Darkness::Astronomical,
                moon: MoonCriterion::None,
                min_duration_minutes: 60,
            },
            lead_minutes: 60,
            expected: None,
            state: SubscriptionState::Enabled,
            block_reason: None,
        };
        catalog.put_reminder_subscription(&write).await.unwrap();
        catalog.limit_writer_pages_for_test().await.unwrap();

        let large = site_input(format!("Backyard {}", "x".repeat(64 * 1024)));
        let error = catalog.save_site(None, None, &large).await.unwrap_err();
        assert_eq!(error.response(None, None).kind, "persistence_failure", "{error}");

        // Claims fill the free space of existing pages first; the first claim
        // that needs a new page fails and stores nothing.
        let mut claimed = Vec::new();
        let failed = loop {
            let start = datetime!(2026-10-20 20:00 UTC)
                + time::Duration::days(claimed.len().try_into().unwrap());
            let claim = DeliveryClaim {
                key: WindowKey::new(target.candidate.id, site.id, start).unwrap(),
                window_end_utc: start + time::Duration::hours(2),
                night: date!(2026 - 10 - 20),
                due_at: start - time::Duration::hours(1),
            };
            match catalog.claim_reminder_delivery(&claim).await {
                Ok(true) => claimed.push(claim.key),
                Ok(false) => panic!("a fresh identity was refused"),
                Err(error) => {
                    assert_eq!(error.response(None, None).kind, "persistence_failure", "{error}");
                    break claim.key;
                }
            }
            assert!(claimed.len() < 100_000, "the page limit never applied");
        };
        catalog.close().await.unwrap();

        let reopened = Catalog::open(&path).await.unwrap();
        let sites = reopened.list_sites().await.unwrap();
        assert_eq!(sites.sites, [site]);
        let deliveries = reopened.reminder_deliveries(0, 0).await.unwrap();
        let mut keys: Vec<WindowKey> = deliveries.iter().map(|row| row.window_key).collect();
        keys.reverse();
        assert_eq!(keys, claimed);
        assert!(deliveries.iter().all(|row| row.window_key != failed));
        assert!(deliveries.iter().all(|row| row.state == DeliveryState::Uncertain));
    }
}
