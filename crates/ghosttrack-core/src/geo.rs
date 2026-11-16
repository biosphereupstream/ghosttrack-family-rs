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

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RoutePointInput {
    pub lat: f64,
    pub lng: f64,
    pub battery_pct: Option<i32>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RouteStats {
    pub point_count: usize,
    pub total_distance_m: f64,
    pub total_distance_km: f64,
    pub min_battery: i32,
    pub max_battery: i32,
}

/// Sums sequential Haversine distances and tracks battery min/max across ordered route points.
pub fn calculate_route_stats(points: &[RoutePointInput]) -> RouteStats {
    if points.is_empty() {
        return RouteStats {
            point_count: 0,
            total_distance_m: 0.0,
            total_distance_km: 0.0,
            min_battery: 0,
            max_battery: 0,
        };
    }

    let mut total_m = 0.0;
    for pair in points.windows(2) {
        total_m += haversine_m(pair[0].lat, pair[0].lng, pair[1].lat, pair[1].lng);
    }

    let batteries: Vec<i32> = points.iter().filter_map(|p| p.battery_pct).collect();
    let (min_bat, max_bat) = if batteries.is_empty() {
        (0, 0)
    } else {
        (
            *batteries.iter().min().unwrap_or(&0),
            *batteries.iter().max().unwrap_or(&0),
        )
    };

    let rounded_m = (total_m * 100.0).round() / 100.0;
    let rounded_km = ((total_m / 1000.0) * 1000.0).round() / 1000.0;

    RouteStats {
        point_count: points.len(),
        total_distance_m: rounded_m,
        total_distance_km: rounded_km,
        min_battery: min_bat,
        max_battery: max_bat,
    }
}
