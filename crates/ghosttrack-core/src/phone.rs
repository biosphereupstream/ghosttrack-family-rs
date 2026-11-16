use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PhoneInfo {
    pub input: String,
    pub valid: bool,
    pub e164: String,
    pub international: String,
    pub national: String,
    pub country: String,
    pub country_code: String,
    pub iso_code: String,
    pub carrier: String,
    pub region: String,
    pub timezone: String,
    pub number_type: String,
    pub whatsapp_url: String,
    pub telegram_url: String,
    pub error: Option<String>,
}

struct CountryMeta {
    code: &'static str,
    iso: &'static str,
    name: &'static str,
    region: &'static str,
    timezone: &'static str,
    min_len: usize,
    max_len: usize,
}

const COUNTRIES: &[CountryMeta] = &[
    CountryMeta { code: "673", iso: "BN", name: "Brunei Darussalam", region: "Asia Tenggara", timezone: "Asia/Brunei (UTC+8)", min_len: 7, max_len: 7 },
    CountryMeta { code: "670", iso: "TL", name: "Timor-Leste", region: "Asia Tenggara", timezone: "Asia/Dili (UTC+9)", min_len: 7, max_len: 8 },
    CountryMeta { code: "852", iso: "HK", name: "Hong Kong", region: "Asia Timur", timezone: "Asia/Hong_Kong (UTC+8)", min_len: 8, max_len: 8 },
    CountryMeta { code: "886", iso: "TW", name: "Taiwan", region: "Asia Timur", timezone: "Asia/Taipei (UTC+8)", min_len: 8, max_len: 9 },
    CountryMeta { code: "880", iso: "BD", name: "Bangladesh", region: "Asia Selatan", timezone: "Asia/Dhaka (UTC+6)", min_len: 10, max_len: 10 },
    CountryMeta { code: "966", iso: "SA", name: "Arab Saudi", region: "Timur Tengah", timezone: "Asia/Riyadh (UTC+3)", min_len: 9, max_len: 9 },
    CountryMeta { code: "971", iso: "AE", name: "Uni Emirat Arab", region: "Timur Tengah", timezone: "Asia/Dubai (UTC+4)", min_len: 9, max_len: 9 },
    CountryMeta { code: "351", iso: "PT", name: "Portugal", region: "Eropa", timezone: "Europe/Lisbon (UTC+0)", min_len: 9, max_len: 9 },
    CountryMeta { code: "62", iso: "ID", name: "Indonesia", region: "Asia Tenggara", timezone: "WIB/WITA/WIT (UTC+7..+9)", min_len: 8, max_len: 13 },
    CountryMeta { code: "65", iso: "SG", name: "Singapura", region: "Asia Tenggara", timezone: "Asia/Singapore (UTC+8)", min_len: 8, max_len: 8 },
    CountryMeta { code: "60", iso: "MY", name: "Malaysia", region: "Asia Tenggara", timezone: "Asia/Kuala_Lumpur (UTC+8)", min_len: 9, max_len: 10 },
    CountryMeta { code: "66", iso: "TH", name: "Thailand", region: "Asia Tenggara", timezone: "Asia/Bangkok (UTC+7)", min_len: 9, max_len: 9 },
    CountryMeta { code: "63", iso: "PH", name: "Filipina", region: "Asia Tenggara", timezone: "Asia/Manila (UTC+8)", min_len: 10, max_len: 10 },
    CountryMeta { code: "84", iso: "VN", name: "Vietnam", region: "Asia Tenggara", timezone: "Asia/Ho_Chi_Minh (UTC+7)", min_len: 9, max_len: 10 },
    CountryMeta { code: "61", iso: "AU", name: "Australia", region: "Oseania", timezone: "Australia/Sydney (UTC+10)", min_len: 9, max_len: 9 },
    CountryMeta { code: "64", iso: "NZ", name: "Selandia Baru", region: "Oseania", timezone: "Pacific/Auckland (UTC+12)", min_len: 8, max_len: 10 },
    CountryMeta { code: "81", iso: "JP", name: "Jepang", region: "Asia Timur", timezone: "Asia/Tokyo (UTC+9)", min_len: 9, max_len: 10 },
    CountryMeta { code: "82", iso: "KR", name: "Korea Selatan", region: "Asia Timur", timezone: "Asia/Seoul (UTC+9)", min_len: 9, max_len: 10 },
    CountryMeta { code: "86", iso: "CN", name: "Tiongkok", region: "Asia Timur", timezone: "Asia/Shanghai (UTC+8)", min_len: 11, max_len: 11 },
    CountryMeta { code: "91", iso: "IN", name: "India", region: "Asia Selatan", timezone: "Asia/Kolkata (UTC+5:30)", min_len: 10, max_len: 10 },
    CountryMeta { code: "92", iso: "PK", name: "Pakistan", region: "Asia Selatan", timezone: "Asia/Karachi (UTC+5)", min_len: 10, max_len: 10 },
    CountryMeta { code: "44", iso: "GB", name: "Inggris (UK)", region: "Eropa", timezone: "Europe/London (UTC+0)", min_len: 10, max_len: 10 },
    CountryMeta { code: "49", iso: "DE", name: "Jerman", region: "Eropa", timezone: "Europe/Berlin (UTC+1)", min_len: 10, max_len: 11 },
    CountryMeta { code: "33", iso: "FR", name: "Prancis", region: "Eropa", timezone: "Europe/Paris (UTC+1)", min_len: 9, max_len: 9 },
    CountryMeta { code: "31", iso: "NL", name: "Belanda", region: "Eropa", timezone: "Europe/Amsterdam (UTC+1)", min_len: 9, max_len: 9 },
    CountryMeta { code: "39", iso: "IT", name: "Italia", region: "Eropa", timezone: "Europe/Rome (UTC+1)", min_len: 9, max_len: 10 },
    CountryMeta { code: "34", iso: "ES", name: "Spanyol", region: "Eropa", timezone: "Europe/Madrid (UTC+1)", min_len: 9, max_len: 9 },
    CountryMeta { code: "41", iso: "CH", name: "Swiss", region: "Eropa", timezone: "Europe/Zurich (UTC+1)", min_len: 9, max_len: 9 },
    CountryMeta { code: "46", iso: "SE", name: "Swedia", region: "Eropa", timezone: "Europe/Stockholm (UTC+1)", min_len: 9, max_len: 9 },
    CountryMeta { code: "47", iso: "NO", name: "Norwegia", region: "Eropa", timezone: "Europe/Oslo (UTC+1)", min_len: 8, max_len: 8 },
    CountryMeta { code: "45", iso: "DK", name: "Denmark", region: "Eropa", timezone: "Europe/Copenhagen (UTC+1)", min_len: 8, max_len: 8 },
    CountryMeta { code: "48", iso: "PL", name: "Polandia", region: "Eropa", timezone: "Europe/Warsaw (UTC+1)", min_len: 9, max_len: 9 },
    CountryMeta { code: "30", iso: "GR", name: "Yunani", region: "Eropa", timezone: "Europe/Athens (UTC+2)", min_len: 10, max_len: 10 },
    CountryMeta { code: "90", iso: "TR", name: "Turki", region: "Eropa/Asia", timezone: "Europe/Istanbul (UTC+3)", min_len: 10, max_len: 10 },
    CountryMeta { code: "55", iso: "BR", name: "Brasil", region: "Amerika Selatan", timezone: "America/Sao_Paulo (UTC-3)", min_len: 10, max_len: 11 },
    CountryMeta { code: "52", iso: "MX", name: "Meksiko", region: "Amerika Utara", timezone: "America/Mexico_City (UTC-6)", min_len: 10, max_len: 10 },
    CountryMeta { code: "20", iso: "EG", name: "Mesir", region: "Afrika", timezone: "Africa/Cairo (UTC+2)", min_len: 9, max_len: 10 },
    CountryMeta { code: "27", iso: "ZA", name: "Afrika Selatan", region: "Afrika", timezone: "Africa/Johannesburg (UTC+2)", min_len: 9, max_len: 9 },
    CountryMeta { code: "1", iso: "US", name: "Amerika Serikat / Kanada", region: "Amerika Utara", timezone: "America/New_York..Los_Angeles (UTC-5..-8)", min_len: 10, max_len: 10 },
    CountryMeta { code: "7", iso: "RU", name: "Rusia / Kazakhstan", region: "Eurasia", timezone: "Europe/Moscow (UTC+3)", min_len: 10, max_len: 10 },
];

fn detect_indonesian_details(nsn: &str) -> (&'static str, &'static str, &'static str, &'static str) {
    // Returns (carrier, region, timezone, number_type)
    if nsn.starts_with("811")
        || nsn.starts_with("812")
        || nsn.starts_with("813")
        || nsn.starts_with("821")
        || nsn.starts_with("822")
        || nsn.starts_with("823")
        || nsn.starts_with("852")
        || nsn.starts_with("853")
    {
        return ("Telkomsel (Halo/Simpati/AS)", "Indonesia (Nasional)", "WIB/WITA/WIT (UTC+7..+9)", "Seluler (GSM)");
    }
    if nsn.starts_with("851") {
        if nsn.starts_with("85154")
            || nsn.starts_with("85155")
            || nsn.starts_with("85156")
            || nsn.starts_with("85157")
            || nsn.starts_with("85158")
            || nsn.starts_with("8516")
            || nsn.starts_with("8517")
        {
            return ("By.U (Telkomsel Digital)", "Indonesia (Nasional)", "WIB/WITA/WIT (UTC+7..+9)", "Seluler Digital (GSM)");
        }
        return ("Telkomsel (Kartu AS / By.U)", "Indonesia (Nasional)", "WIB/WITA/WIT (UTC+7..+9)", "Seluler (GSM)");
    }
    if nsn.starts_with("814")
        || nsn.starts_with("815")
        || nsn.starts_with("816")
        || nsn.starts_with("855")
        || nsn.starts_with("856")
        || nsn.starts_with("857")
        || nsn.starts_with("858")
    {
        return ("Indosat Ooredoo Hutchison (IM3/Mentari)", "Indonesia (Nasional)", "WIB/WITA/WIT (UTC+7..+9)", "Seluler (GSM)");
    }
    if nsn.starts_with("817")
        || nsn.starts_with("818")
        || nsn.starts_with("819")
        || nsn.starts_with("859")
        || nsn.starts_with("877")
        || nsn.starts_with("878")
    {
        return ("XL Axiata", "Indonesia (Nasional)", "WIB/WITA/WIT (UTC+7..+9)", "Seluler (GSM)");
    }
    if nsn.starts_with("831")
        || nsn.starts_with("832")
        || nsn.starts_with("833")
        || nsn.starts_with("838")
    {
        return ("AXIS (XL Axiata)", "Indonesia (Nasional)", "WIB/WITA/WIT (UTC+7..+9)", "Seluler (GSM)");
    }
    if nsn.starts_with("895")
        || nsn.starts_with("896")
        || nsn.starts_with("897")
        || nsn.starts_with("898")
        || nsn.starts_with("899")
    {
        return ("Tri / 3 (Indosat Ooredoo Hutchison)", "Indonesia (Nasional)", "WIB/WITA/WIT (UTC+7..+9)", "Seluler (GSM)");
    }
    if nsn.starts_with("881")
        || nsn.starts_with("882")
        || nsn.starts_with("883")
        || nsn.starts_with("884")
        || nsn.starts_with("885")
        || nsn.starts_with("886")
        || nsn.starts_with("887")
        || nsn.starts_with("888")
        || nsn.starts_with("889")
    {
        return ("Smartfren Telecom", "Indonesia (Nasional)", "WIB/WITA/WIT (UTC+7..+9)", "Seluler (4G LTE)");
    }
    if nsn.starts_with("21") {
        return ("Telkom Indonesia (PSTN)", "Jabodetabek (DKI Jakarta)", "Asia/Jakarta (WIB, UTC+7)", "Telepon Rumah/Kantor (Fixed Line)");
    }
    if nsn.starts_with("22") {
        return ("Telkom Indonesia (PSTN)", "Bandung & Sekitarnya (Jawa Barat)", "Asia/Jakarta (WIB, UTC+7)", "Telepon Rumah/Kantor (Fixed Line)");
    }
    if nsn.starts_with("24") {
        return ("Telkom Indonesia (PSTN)", "Semarang & Sekitarnya (Jawa Tengah)", "Asia/Jakarta (WIB, UTC+7)", "Telepon Rumah/Kantor (Fixed Line)");
    }
    if nsn.starts_with("274") {
        return ("Telkom Indonesia (PSTN)", "Yogyakarta (DIY)", "Asia/Jakarta (WIB, UTC+7)", "Telepon Rumah/Kantor (Fixed Line)");
    }
    if nsn.starts_with("31") {
        return ("Telkom Indonesia (PSTN)", "Surabaya & Sekitarnya (Jawa Timur)", "Asia/Jakarta (WIB, UTC+7)", "Telepon Rumah/Kantor (Fixed Line)");
    }
    if nsn.starts_with("361") {
        return ("Telkom Indonesia (PSTN)", "Denpasar & Badung (Bali)", "Asia/Makassar (WITA, UTC+8)", "Telepon Rumah/Kantor (Fixed Line)");
    }
    if nsn.starts_with("411") {
        return ("Telkom Indonesia (PSTN)", "Makassar (Sulawesi Selatan)", "Asia/Makassar (WITA, UTC+8)", "Telepon Rumah/Kantor (Fixed Line)");
    }
    if nsn.starts_with("61") {
        return ("Telkom Indonesia (PSTN)", "Medan & Sekitarnya (Sumatera Utara)", "Asia/Jakarta (WIB, UTC+7)", "Telepon Rumah/Kantor (Fixed Line)");
    }
    if nsn.starts_with('8') {
        return ("Operator Seluler Indonesia", "Indonesia", "WIB/WITA/WIT (UTC+7..+9)", "Seluler");
    }

    ("Telkom / Fixed Line Indonesia", "Indonesia", "WIB/WITA/WIT (UTC+7..+9)", "Fixed Line / VoIP")
}

fn format_grouped(digits: &str) -> String {
    let chars: Vec<char> = digits.chars().collect();
    let mut parts = Vec::new();
    let mut idx = 0;
    while idx < chars.len() {
        let end = (idx + 4).min(chars.len());
        parts.push(chars[idx..end].iter().collect::<String>());
        idx = end;
    }
    parts.join("-")
}

pub fn parse_phone(raw: &str, default_country: Option<&str>) -> PhoneInfo {
    let trimmed = raw.trim();
    if trimmed.is_empty() {
        return PhoneInfo {
            input: raw.to_string(),
            valid: false,
            e164: String::new(),
            international: String::new(),
            national: String::new(),
            country: String::new(),
            country_code: String::new(),
            iso_code: String::new(),
            carrier: String::new(),
            region: String::new(),
            timezone: String::new(),
            number_type: String::new(),
            whatsapp_url: String::new(),
            telegram_url: String::new(),
            error: Some("Nomor telepon tidak boleh kosong".to_string()),
        };
    }

    let has_plus = trimmed.starts_with('+');
    let mut digits: String = trimmed.chars().filter(|c| c.is_ascii_digit()).collect();

    if digits.starts_with("00") && digits.len() > 4 {
        digits = digits[2..].to_string();
    }

    let default_iso = default_country.unwrap_or("ID").to_ascii_uppercase();

    // Normalize local Indonesian number starting with 0 (e.g. 0812...) when no explicit + international prefix
    let full_digits = if !has_plus && digits.starts_with('0') && digits.len() >= 8 && default_iso == "ID" {
        format!("62{}", &digits[1..])
    } else if !has_plus && digits.starts_with('8') && digits.len() >= 8 && digits.len() <= 12 && default_iso == "ID" {
        format!("62{}", digits)
    } else {
        digits
    };

    // Match longest country code prefix
    for meta in COUNTRIES {
        if let Some(nsn) = full_digits.strip_prefix(meta.code) {
            let valid = nsn.len() >= meta.min_len && nsn.len() <= meta.max_len;
            let e164 = format!("+{}{}", meta.code, nsn);
            let international = format!("+{} {}", meta.code, format_grouped(nsn));
            let national = if meta.iso == "ID" {
                format!("0{}", format_grouped(nsn))
            } else {
                format_grouped(nsn)
            };

            let (carrier, region, timezone, number_type) = if meta.iso == "ID" {
                let (c, r, tz, nt) = detect_indonesian_details(nsn);
                (c.to_string(), r.to_string(), tz.to_string(), nt.to_string())
            } else {
                (
                    format!("Carrier {} (+{})", meta.name, meta.code),
                    meta.region.to_string(),
                    meta.timezone.to_string(),
                    "Seluler / Internasional".to_string(),
                )
            };

            let clean_wa = format!("{}{}", meta.code, nsn);
            return PhoneInfo {
                input: raw.to_string(),
                valid,
                e164: e164.clone(),
                international,
                national,
                country: meta.name.to_string(),
                country_code: format!("+{}", meta.code),
                iso_code: meta.iso.to_string(),
                carrier,
                region,
                timezone,
                number_type,
                whatsapp_url: format!("https://wa.me/{}", clean_wa),
                telegram_url: format!("https://t.me/+{}", clean_wa),
                error: if valid {
                    None
                } else {
                    Some(format!(
                        "Panjang digit ({}) di luar rentang standar {} ({}-{} digit)",
                        nsn.len(),
                        meta.name,
                        meta.min_len,
                        meta.max_len
                    ))
                },
            };
        }
    }

    PhoneInfo {
        input: raw.to_string(),
        valid: false,
        e164: format!("+{}", full_digits),
        international: format!("+{}", full_digits),
        national: full_digits,
        country: "Tidak Diketahui".to_string(),
        country_code: String::new(),
        iso_code: String::new(),
        carrier: "Tidak Teridentifikasi".to_string(),
        region: "Global".to_string(),
        timezone: "UTC".to_string(),
        number_type: "Unknown".to_string(),
        whatsapp_url: String::new(),
        telegram_url: String::new(),
        error: Some("Kode negara tidak dikenali. Gunakan format +62... atau 08...".to_string()),
    }
}
