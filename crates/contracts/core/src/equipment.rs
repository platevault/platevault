//! Equipment contract DTOs for the Tauri IPC surface.

use serde::{Deserialize, Serialize};
use specta::Type;

#[derive(Clone, Copy, Debug, Eq, Hash, Ord, PartialEq, PartialOrd, Serialize, Deserialize, Type)]
#[serde(rename_all = "snake_case")]
pub enum FilterCategory {
    Narrowband,
    Broadband,
    DualBand,
    Other,
    Custom,
}

#[derive(Clone, Debug, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct Camera {
    pub id: String,
    pub name: String,
    pub aliases: Vec<String>,
    pub auto_detected: bool,
}

#[derive(Clone, Debug, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct Telescope {
    pub id: String,
    pub name: String,
    pub aliases: Vec<String>,
    pub focal_length_mm: Option<i32>,
    pub auto_detected: bool,
}

#[derive(Clone, Debug, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct OpticalTrain {
    pub id: String,
    pub name: String,
    pub telescope_id: Option<String>,
    pub camera_id: Option<String>,
    pub focal_length_mm: i32,
}

#[derive(Clone, Debug, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct Filter {
    pub id: String,
    pub name: String,
    pub category: FilterCategory,
    pub auto_detected: bool,
}

#[derive(Clone, Debug, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct CreateCamera {
    pub name: String,
    pub aliases: Vec<String>,
}

#[derive(Clone, Debug, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct UpdateCamera {
    pub id: String,
    pub name: String,
    pub aliases: Vec<String>,
}

#[derive(Clone, Debug, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct CreateTelescope {
    pub name: String,
    pub aliases: Vec<String>,
    pub focal_length_mm: Option<i32>,
}

#[derive(Clone, Debug, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct UpdateTelescope {
    pub id: String,
    pub name: String,
    pub aliases: Vec<String>,
    pub focal_length_mm: Option<i32>,
}

#[derive(Clone, Debug, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct CreateOpticalTrain {
    pub name: String,
    pub telescope_id: Option<String>,
    pub camera_id: Option<String>,
    pub focal_length_mm: i32,
}

#[derive(Clone, Debug, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct UpdateOpticalTrain {
    pub id: String,
    pub name: String,
    pub telescope_id: Option<String>,
    pub camera_id: Option<String>,
    pub focal_length_mm: i32,
}

#[derive(Clone, Debug, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct CreateFilter {
    pub name: String,
    pub category: FilterCategory,
}

#[derive(Clone, Debug, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct UpdateFilter {
    pub id: String,
    pub name: String,
    pub category: FilterCategory,
}
