// Copyright (C) 2024-2026 Sjors Robroek
// SPDX-License-Identifier: AGPL-3.0-only

//! Updater-owned catalogue text, independent from OS completion notifications.

use std::path::Path;

use serde::Deserialize;

use crate::locale::{self, ActiveLocale, ShippedMessages};
use crate::notifications::Notice;

#[derive(Debug, Deserialize)]
pub struct Wording {
    #[serde(rename = "update_admin_prompt")]
    admin_prompt: String,
    #[serde(rename = "update_notification_install_failed_title")]
    install_failed_title: String,
    #[serde(rename = "settings_advanced_updates_installfailed")]
    install_failed: String,
    #[serde(rename = "update_error_previous_app_not_restored")]
    previous_app_not_restored: String,
}

static WORDING_BY_LOCALE: ShippedMessages<Wording> = ShippedMessages::new();

impl Wording {
    fn for_locale(locale: &'static crate::locale::ShippedLocale) -> &'static Self {
        WORDING_BY_LOCALE.get(locale)
    }

    pub(super) fn for_active(locale: &ActiveLocale) -> &'static Self {
        Self::for_locale(locale.get())
    }

    #[cfg(test)]
    pub(super) fn from_locale(locale: &'static crate::locale::ShippedLocale) -> &'static Self {
        Self::for_locale(locale)
    }

    pub(super) fn admin_prompt(&self, version: &str) -> String {
        locale::fill(&self.admin_prompt, &[("version", version)])
    }

    pub(super) fn previous_app_kept(&self, kept: &Path) -> Notice {
        let reason =
            locale::fill(&self.previous_app_not_restored, &[("path", &kept.display().to_string())]);
        Notice {
            title: self.install_failed_title.clone(),
            body: locale::fill(&self.install_failed, &[("message", &reason)]),
        }
    }
}
