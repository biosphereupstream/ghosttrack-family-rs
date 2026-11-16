use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct OsintPlatformTarget {
    pub site: String,
    pub url: String,
    pub category: String,
}

pub fn sanitize_username(raw: &str) -> String {
    raw.trim()
        .trim_start_matches('@')
        .chars()
        .filter(|c| c.is_ascii_alphanumeric() || matches!(c, '.' | '_' | '-'))
        .collect()
}

pub fn build_osint_targets(raw_username: &str) -> Vec<OsintPlatformTarget> {
    let u = sanitize_username(raw_username);
    if u.is_empty() {
        return Vec::new();
    }

    let specs: &[(&str, &str, &str)] = &[
        ("GitHub", "https://www.github.com/{}", "Developer"),
        ("Instagram", "https://www.instagram.com/{}", "Social"),
        ("TikTok", "https://www.tiktok.com/@{}", "Video"),
        ("X (Twitter)", "https://x.com/{}", "Social"),
        ("Facebook", "https://www.facebook.com/{}", "Social"),
        ("YouTube", "https://www.youtube.com/@{}", "Video"),
        ("Telegram", "https://t.me/{}", "Messaging"),
        ("Reddit", "https://www.reddit.com/user/{}", "Forum"),
        ("LinkedIn", "https://www.linkedin.com/in/{}", "Professional"),
        ("Pinterest", "https://www.pinterest.com/{}", "Visual"),
        ("Medium", "https://medium.com/@{}", "Writing"),
        ("Twitch", "https://www.twitch.tv/{}", "Streaming"),
        ("SoundCloud", "https://soundcloud.com/{}", "Audio"),
        ("Dribbble", "https://dribbble.com/{}", "Design"),
        ("Behance", "https://www.behance.net/{}", "Design"),
        ("Tumblr", "https://{}.tumblr.com", "Blogging"),
        ("Flickr", "https://www.flickr.com/people/{}", "Photo"),
        ("Quora", "https://www.quora.com/profile/{}", "Q&A"),
        ("Product Hunt", "https://www.producthunt.com/@{}", "Tech"),
        ("Snapchat", "https://www.snapchat.com/add/{}", "Social"),
        ("GitLab", "https://gitlab.com/{}", "Developer"),
        ("Dev.to", "https://dev.to/{}", "Developer"),
    ];

    specs
        .iter()
        .map(|(site, pattern, category)| OsintPlatformTarget {
            site: (*site).to_string(),
            url: pattern.replace("{}", &u),
            category: (*category).to_string(),
        })
        .collect()
}
