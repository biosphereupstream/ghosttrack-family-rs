use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SafeZoneInput {
    pub id: Option<String>,
    pub name: String,
    pub lat: f64,
    pub lng: f64,
    pub radius_m: f64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SafeZoneCheck {
    pub zone_name: String,
    pub distance_m: f64,
    pub radius_m: f64,
    pub inside: bool,
    pub bearing_deg: f64,
    pub direction: String,
}

const EARTH_RADIUS_M: f64 = 6_371_000.0;

pub fn haversine_m(lat1: f64, lng1: f64, lat2: f64, lng2: f64) -> f64 {
    let phi1 = lat1.to_radians();
    let phi2 = lat2.to_radians();
    let d_phi = (lat2 - lat1).to_radians();
    let d_lambda = (lng2 - lng1).to_radians();

    let a = (d_phi / 2.0).sin().powi(2)
        + phi1.cos() * phi2.cos() * (d_lambda / 2.0).sin().powi(2);
    let c = 2.0 * a.sqrt().atan2((1.0 - a).sqrt());

    (EARTH_RADIUS_M * c * 100.0).round() / 100.0
}

pub fn bearing_deg(lat1: f64, lng1: f64, lat2: f64, lng2: f64) -> f64 {
    let phi1 = lat1.to_radians();
    let phi2 = lat2.to_radians();
    let d_lambda = (lng2 - lng1).to_radians();

    let y = d_lambda.sin() * phi2.cos();
    let x = phi1.cos() * phi2.sin() - phi1.sin() * phi2.cos() * d_lambda.cos();
    let brng = y.atan2(x).to_degrees();
    ((brng + 360.0) % 360.0 * 10.0).round() / 10.0
}

pub fn compass_label(deg: f64) -> &'static str {
    let idx = (((deg + 22.5) / 45.0).floor() as usize) % 8;
    match idx {
        0 => "Utara",
        1 => "Timur Laut",
        2 => "Timur",
        3 => "Tenggara",
        4 => "Selatan",
        5 => "Barat Daya",
        6 => "Barat",
        _ => "Barat Laut",
    }
}

pub fn evaluate_geofences(lat: f64, lng: f64, zones: &[SafeZoneInput]) -> Vec<SafeZoneCheck> {
    zones
        .iter()
        .map(|z| {
            let dist = haversine_m(lat, lng, z.lat, z.lng);
            let brng = bearing_deg(z.lat, z.lng, lat, lng);
            SafeZoneCheck {
                zone_name: z.name.clone(),
                distance_m: dist,
                radius_m: z.radius_m,
                inside: dist <= z.radius_m,
                bearing_deg: brng,
                direction: compass_label(brng).to_string(),
            }
        })
        .collect()
}
