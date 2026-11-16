use axum::{
    extract::{Query, State},
    http::StatusCode,
    response::IntoResponse,
    routing::get,
    Json, Router,
};
use chrono::Utc;
use ghosttrack_core::{
    geo::{evaluate_geofences, SafeZoneCheck, SafeZoneInput},
    osint::build_osint_targets,
    phone::parse_phone,
    security::{derive_invite_code, hash_family_pin, normalize_group_code},
};
use serde::{Deserialize, Serialize};
use std::{
    collections::HashMap,
    net::SocketAddr,
    sync::Arc,
    time::Duration,
};
use tokio::sync::RwLock;
use tower_http::{
    cors::{Any, CorsLayer},
    services::ServeDir,
};

#[derive(Debug, Clone, Serialize, Deserialize)]
struct MemberRecord {
    member_id: String,
    name: String,
    role: String,
    phone: String,
    avatar: String,
    lat: f64,
    lng: f64,
    accuracy_m: f64,
    speed_kmh: f64,
    battery_pct: i32,
    status_label: String,
    sos_active: bool,
    consent_granted: bool,
    updated_at: String,
    #[serde(default)]
    geofences: Vec<SafeZoneCheck>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
struct LocationPoint {
    member_id: String,
    member_name: String,
    lat: f64,
    lng: f64,
    battery_pct: i32,
    status_label: String,
    recorded_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
struct FamilyGroup {
    group_code: String,
    family_name: String,
    pin_hash: String,
    created_at: String,
    members: HashMap<String, MemberRecord>,
    safe_zones: Vec<SafeZoneInput>,
    history: Vec<LocationPoint>,
}

struct AppState {
    groups: RwLock<HashMap<String, FamilyGroup>>,
    http: reqwest::Client,
    database_url: Option<String>,
}

impl AppState {
    fn new() -> Self {
        let mut groups = HashMap::new();
        let demo_code = "KEL-777".to_string();
        let pin_hash = hash_family_pin(&demo_code, "1234");
        let now = Utc::now().to_rfc3339();

        let mut members = HashMap::new();
        members.insert(
            "ayah".to_string(),
            MemberRecord {
                member_id: "ayah".to_string(),
                name: "Ayah (Budi)".to_string(),
                role: "Orang Tua".to_string(),
                phone: "+6281234567890".to_string(),
                avatar: "👨".to_string(),
                lat: -6.175392,
                lng: 106.827153,
                accuracy_m: 12.0,
                speed_kmh: 0.0,
                battery_pct: 84,
                status_label: "Di Kantor".to_string(),
                sos_active: false,
                consent_granted: true,
                updated_at: now.clone(),
                geofences: vec![],
            },
        );
        members.insert(
            "ibu".to_string(),
            MemberRecord {
                member_id: "ibu".to_string(),
                name: "Ibu (Sari)".to_string(),
                role: "Orang Tua".to_string(),
                phone: "+6281598765432".to_string(),
                avatar: "👩".to_string(),
                lat: -6.186486,
                lng: 106.834091,
                accuracy_m: 9.5,
                speed_kmh: 0.0,
                battery_pct: 91,
                status_label: "Di Rumah".to_string(),
                sos_active: false,
                consent_granted: true,
                updated_at: now.clone(),
                geofences: vec![],
            },
        );
        members.insert(
            "anak".to_string(),
            MemberRecord {
                member_id: "anak".to_string(),
                name: "Raka (Anak)".to_string(),
                role: "Anak".to_string(),
                phone: "+6289611223344".to_string(),
                avatar: "🧒".to_string(),
                lat: -6.194957,
                lng: 106.823045,
                accuracy_m: 15.0,
                speed_kmh: 18.4,
                battery_pct: 63,
                status_label: "Pulang Sekolah".to_string(),
                sos_active: false,
                consent_granted: true,
                updated_at: now.clone(),
                geofences: vec![],
            },
        );

        let safe_zones = vec![
            SafeZoneInput {
                id: Some("sz-home".to_string()),
                name: "Rumah Keluarga".to_string(),
                lat: -6.186486,
                lng: 106.834091,
                radius_m: 250.0,
            },
            SafeZoneInput {
                id: Some("sz-school".to_string()),
                name: "Sekolah / Kampus".to_string(),
                lat: -6.194957,
                lng: 106.823045,
                radius_m: 300.0,
            },
        ];

        let history = vec![
            LocationPoint {
                member_id: "anak".to_string(),
                member_name: "Raka (Anak)".to_string(),
                lat: -6.1982,
                lng: 106.8211,
                battery_pct: 68,
                status_label: "Berangkat Pulang".to_string(),
                recorded_at: now.clone(),
            },
            LocationPoint {
                member_id: "anak".to_string(),
                member_name: "Raka (Anak)".to_string(),
                lat: -6.194957,
                lng: 106.823045,
                battery_pct: 63,
                status_label: "Pulang Sekolah".to_string(),
                recorded_at: now.clone(),
            },
        ];

        groups.insert(
            demo_code.clone(),
            FamilyGroup {
                group_code: demo_code,
                family_name: "Keluarga Nusantara (Demo)".to_string(),
                pin_hash,
                created_at: now,
                members,
                safe_zones,
                history,
            },
        );

        let http = reqwest::Client::builder()
            .timeout(Duration::from_secs(8))
            .user_agent("GhostTrack-Family-Rust/1.0")
            .build()
            .expect("reqwest client");

        Self {
            groups: RwLock::new(groups),
            http,
            database_url: std::env::var("DATABASE_URL").ok().filter(|v| !v.is_empty()),
        }
    }
}

#[derive(Deserialize)]
struct PhoneQuery {
    number: Option<String>,
    country: Option<String>,
}

#[derive(Deserialize)]
struct IpQuery {
    ip: Option<String>,
}

#[derive(Deserialize)]
struct UsernameQuery {
    username: Option<String>,
}

#[derive(Deserialize)]
struct FamilyQuery {
    group_code: Option<String>,
    pin: Option<String>,
}

#[derive(Deserialize)]
struct FamilyActionBody {
    action: String,
    group_code: Option<String>,
    family_name: Option<String>,
    pin: Option<String>,
    member_id: Option<String>,
    name: Option<String>,
    role: Option<String>,
    phone: Option<String>,
    avatar: Option<String>,
    lat: Option<f64>,
    lng: Option<f64>,
    accuracy_m: Option<f64>,
    speed_kmh: Option<f64>,
    battery_pct: Option<i32>,
    status_label: Option<String>,
    sos_active: Option<bool>,
    consent_granted: Option<bool>,
    zone_name: Option<String>,
    radius_m: Option<f64>,
}

async fn health(State(state): State<Arc<AppState>>) -> impl IntoResponse {
    Json(serde_json::json!({
        "ok": true,
        "engine": "ghosttrack-server (Rust Axum)",
        "database_mode": if state.database_url.is_some() { "neon-configured" } else { "in-memory" },
        "timestamp": Utc::now().to_rfc3339()
    }))
}

async fn api_phone(
    State(state): State<Arc<AppState>>,
    Query(q): Query<PhoneQuery>,
) -> impl IntoResponse {
    let number = q.number.unwrap_or_default();
    let info = parse_phone(&number, q.country.as_deref());

    let mut matched_family_members = Vec::new();
    if info.valid {
        let groups = state.groups.read().await;
        for g in groups.values() {
            for m in g.members.values() {
                let parsed_member = parse_phone(&m.phone, Some("ID"));
                if parsed_member.e164 == info.e164 {
                    matched_family_members.push(serde_json::json!({
                        "group_code": g.group_code,
                        "family_name": g.family_name,
                        "member_id": m.member_id,
                        "name": m.name,
                        "lat": m.lat,
                        "lng": m.lng,
                        "battery_pct": m.battery_pct,
                        "status_label": m.status_label,
                        "updated_at": m.updated_at
                    }));
                }
            }
        }
    }

    Json(serde_json::json!({
        "engine": "rust-ghosttrack-core",
        "phone": info,
        "family_matches": matched_family_members
    }))
}

async fn api_ip(
    State(state): State<Arc<AppState>>,
    Query(q): Query<IpQuery>,
) -> impl IntoResponse {
    let target = q.ip.unwrap_or_default().trim().to_string();
    let url = if target.is_empty() {
        "https://ipwho.is/".to_string()
    } else {
        format!("https://ipwho.is/{}", target)
    };

    match state.http.get(&url).send().await {
        Ok(resp) => match resp.json::<serde_json::Value>().await {
            Ok(data) => (StatusCode::OK, Json(data)).into_response(),
            Err(e) => (
                StatusCode::BAD_GATEWAY,
                Json(serde_json::json!({ "success": false, "message": e.to_string() })),
            )
                .into_response(),
        },
        Err(e) => (
            StatusCode::BAD_GATEWAY,
            Json(serde_json::json!({ "success": false, "message": e.to_string() })),
        )
            .into_response(),
    }
}

async fn api_username(
    State(state): State<Arc<AppState>>,
    Query(q): Query<UsernameQuery>,
) -> impl IntoResponse {
    let raw = q.username.unwrap_or_default();
    let targets = build_osint_targets(&raw);
    if targets.is_empty() {
        return (
            StatusCode::BAD_REQUEST,
            Json(serde_json::json!({ "error": "Username tidak valid" })),
        )
            .into_response();
    }

    let mut handles = Vec::with_capacity(targets.len());
    for target in targets {
        let client = state.http.clone();
        handles.push(tokio::spawn(async move {
            let status = match client.head(&target.url).send().await {
                Ok(resp) => {
                    let code = resp.status().as_u16();
                    if code == 200 {
                        "found"
                    } else if code == 404 {
                        "not_found"
                    } else {
                        "check_manually"
                    }
                }
                Err(_) => "check_manually",
            };
            serde_json::json!({
                "site": target.site,
                "url": target.url,
                "category": target.category,
                "status": status
            })
        }));
    }

    let mut results = Vec::new();
    for h in handles {
        if let Ok(item) = h.await {
            results.push(item);
        }
    }

    Json(serde_json::json!({
        "username": raw.trim().trim_start_matches('@'),
        "total": results.len(),
        "results": results
    }))
    .into_response()
}

fn enrich_group_response(group: &FamilyGroup) -> serde_json::Value {
    let mut members: Vec<MemberRecord> = group
        .members
        .values()
        .cloned()
        .map(|mut m| {
            m.geofences = evaluate_geofences(m.lat, m.lng, &group.safe_zones);
            m
        })
        .collect();
    members.sort_by(|a, b| a.name.cmp(&b.name));

    serde_json::json!({
        "ok": true,
        "group_code": group.group_code,
        "family_name": group.family_name,
        "created_at": group.created_at,
        "members": members,
        "safe_zones": group.safe_zones,
        "history": group.history
    })
}

async fn get_family(
    State(state): State<Arc<AppState>>,
    Query(q): Query<FamilyQuery>,
) -> impl IntoResponse {
    let code = normalize_group_code(q.group_code.as_deref().unwrap_or("KEL-777"));
    let pin = q.pin.unwrap_or_else(|| "1234".to_string());
    let groups = state.groups.read().await;

    let Some(group) = groups.get(&code) else {
        return (
            StatusCode::NOT_FOUND,
            Json(serde_json::json!({ "ok": false, "error": "Kode grup keluarga tidak ditemukan" })),
        )
            .into_response();
    };

    if group.pin_hash != hash_family_pin(&code, &pin) {
        return (
            StatusCode::UNAUTHORIZED,
            Json(serde_json::json!({ "ok": false, "error": "PIN grup salah" })),
        )
            .into_response();
    }

    (StatusCode::OK, Json(enrich_group_response(group))).into_response()
}

async fn post_family(
    State(state): State<Arc<AppState>>,
    Json(body): Json<FamilyActionBody>,
) -> impl IntoResponse {
    let now = Utc::now().to_rfc3339();
    let mut groups = state.groups.write().await;

    match body.action.as_str() {
        "create_group" => {
            let family_name = body
                .family_name
                .unwrap_or_else(|| "Keluarga Baru".to_string());
            let pin = body.pin.unwrap_or_else(|| "1234".to_string());
            let code = if let Some(c) = body.group_code.filter(|v| !v.trim().is_empty()) {
                normalize_group_code(&c)
            } else {
                derive_invite_code(&format!("{}:{}:{}", family_name, pin, now))
            };

            if groups.contains_key(&code) {
                return (
                    StatusCode::CONFLICT,
                    Json(serde_json::json!({ "ok": false, "error": "Kode grup sudah terpakai" })),
                )
                    .into_response();
            }

            let group = FamilyGroup {
                group_code: code.clone(),
                family_name,
                pin_hash: hash_family_pin(&code, &pin),
                created_at: now,
                members: HashMap::new(),
                safe_zones: Vec::new(),
                history: Vec::new(),
            };
            let resp = enrich_group_response(&group);
            groups.insert(code, group);
            (StatusCode::CREATED, Json(resp)).into_response()
        }
        "update_location" => {
            let code = normalize_group_code(body.group_code.as_deref().unwrap_or(""));
            let pin = body.pin.unwrap_or_default();
            let Some(group) = groups.get_mut(&code) else {
                return (
                    StatusCode::NOT_FOUND,
                    Json(serde_json::json!({ "ok": false, "error": "Grup tidak ditemukan" })),
                )
                    .into_response();
            };
            if group.pin_hash != hash_family_pin(&code, &pin) {
                return (
                    StatusCode::UNAUTHORIZED,
                    Json(serde_json::json!({ "ok": false, "error": "PIN grup salah" })),
                )
                    .into_response();
            }

            let member_id = body
                .member_id
                .unwrap_or_else(|| "member-1".to_string())
                .trim()
                .to_lowercase();
            let name = body.name.unwrap_or_else(|| member_id.clone());
            let lat = body.lat.unwrap_or(-6.175392);
            let lng = body.lng.unwrap_or(106.827153);
            let battery_pct = body.battery_pct.unwrap_or(85).clamp(0, 100);
            let status_label = body.status_label.unwrap_or_else(|| "Aktif".to_string());
            let sos_active = body.sos_active.unwrap_or(false);
            let phone_e164 = parse_phone(body.phone.as_deref().unwrap_or(""), Some("ID")).e164;

            let record = MemberRecord {
                member_id: member_id.clone(),
                name: name.clone(),
                role: body.role.unwrap_or_else(|| "Anggota".to_string()),
                phone: phone_e164,
                avatar: body.avatar.unwrap_or_else(|| "📱".to_string()),
                lat,
                lng,
                accuracy_m: body.accuracy_m.unwrap_or(10.0),
                speed_kmh: body.speed_kmh.unwrap_or(0.0),
                battery_pct,
                status_label: status_label.clone(),
                sos_active,
                consent_granted: body.consent_granted.unwrap_or(true),
                updated_at: now.clone(),
                geofences: vec![],
            };

            group.members.insert(member_id.clone(), record);
            group.history.push(LocationPoint {
                member_id,
                member_name: name,
                lat,
                lng,
                battery_pct,
                status_label,
                recorded_at: now,
            });
            if group.history.len() > 200 {
                let excess = group.history.len() - 200;
                group.history.drain(0..excess);
            }

            (StatusCode::OK, Json(enrich_group_response(group))).into_response()
        }
        "add_safe_zone" => {
            let code = normalize_group_code(body.group_code.as_deref().unwrap_or(""));
            let pin = body.pin.unwrap_or_default();
            let Some(group) = groups.get_mut(&code) else {
                return (
                    StatusCode::NOT_FOUND,
                    Json(serde_json::json!({ "ok": false, "error": "Grup tidak ditemukan" })),
                )
                    .into_response();
            };
            if group.pin_hash != hash_family_pin(&code, &pin) {
                return (
                    StatusCode::UNAUTHORIZED,
                    Json(serde_json::json!({ "ok": false, "error": "PIN grup salah" })),
                )
                    .into_response();
            }

            let zone_name = body.zone_name.unwrap_or_else(|| "Zona Aman".to_string());
            let zone = SafeZoneInput {
                id: Some(format!("sz-{}", group.safe_zones.len() + 1)),
                name: zone_name,
                lat: body.lat.unwrap_or(-6.175392),
                lng: body.lng.unwrap_or(106.827153),
                radius_m: body.radius_m.unwrap_or(250.0).max(50.0),
            };
            group.safe_zones.push(zone);
            (StatusCode::OK, Json(enrich_group_response(group))).into_response()
        }
        _ => (
            StatusCode::BAD_REQUEST,
            Json(serde_json::json!({ "ok": false, "error": "Action tidak dikenal" })),
        )
            .into_response(),
    }
}

#[tokio::main]
async fn main() {
    let state = Arc::new(AppState::new());
    let cors = CorsLayer::new()
        .allow_origin(Any)
        .allow_methods(Any)
        .allow_headers(Any);

    let app = Router::new()
        .route("/api/health", get(health))
        .route("/api/phone", get(api_phone))
        .route("/api/ip", get(api_ip))
        .route("/api/username", get(api_username))
        .route("/api/family", get(get_family).post(post_family))
        .fallback_service(ServeDir::new("public"))
        .layer(cors)
        .with_state(state);

    let port: u16 = std::env::var("PORT")
        .ok()
        .and_then(|p| p.parse().ok())
        .unwrap_or(8787);
    let addr = SocketAddr::from(([0, 0, 0, 0], port));
    println!("GhostTrack Family Rust server listening on http://{}", addr);

    let listener = tokio::net::TcpListener::bind(addr).await.unwrap();
    axum::serve(listener, app).await.unwrap();
}

#[cfg(test)]
mod tests {
    use super::*;

    #[tokio::test]
    async fn test_demo_group_seeded_and_valid_pin() {
        let state = AppState::new();
        let groups = state.groups.read().await;
        let demo = groups.get("KEL-777").expect("demo group exists");
        assert_eq!(demo.pin_hash, hash_family_pin("KEL-777", "1234"));
        assert_eq!(demo.members.len(), 3);
        assert_eq!(demo.safe_zones.len(), 2);
    }
}
