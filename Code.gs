/**
 * Code.gs - Google Apps Script Backend for Unified Multi-Platform Short Video Hub
 * Supports: TikTok, YouTube Shorts, Facebook Reels
 * Auth: Firebase ID Token Verification
 */

const RAPIDAPI_KEY = "43c8a1a325msh85f5d0c88137effp15a4dfjsn3e940067814b";

function doPost(e) {
  const headers = {
    "Content-Type": "application/json; charset=utf-8",
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "POST, GET, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, Authorization"
  };

  try {
    let payload = {};
    if (e && e.postData && e.postData.contents) {
      try {
        payload = JSON.parse(e.postData.contents);
      } catch (err) {
        payload = {};
      }
    }

    const action = payload.action || "";

    switch (action) {
      case "VERIFY_AUTH":
        return handleVerifyAuth(payload, headers);

      case "GET_UNIFIED_FEED":
        return handleGetUnifiedFeed(payload, headers);

      case "EXTRACT_URL":
        return handleExtractUrl(payload, headers);

      default:
        return respondJson({ status: "error", message: "Invalid or unsupported action: " + action }, headers);
    }
  } catch (error) {
    return respondJson({ status: "error", message: error.toString() }, headers);
  }
}

function doGet(e) {
  const headers = {
    "Content-Type": "application/json; charset=utf-8",
    "Access-Control-Allow-Origin": "*"
  };
  return respondJson({ status: "ok", message: "Shorts Hub Backend Service is running." }, headers);
}

function doOptions(e) {
  return ContentService.createTextOutput("")
    .setMimeType(ContentService.MimeType.TEXT)
    .append("");
}

/**
 * Helper to respond with formatted JSON
 */
function respondJson(data, headers) {
  const output = ContentService.createTextOutput(JSON.stringify(data));
  output.setMimeType(ContentService.MimeType.JSON);
  return output;
}

/**
 * 1. Verify Firebase Auth Token
 */
function handleVerifyAuth(payload, headers) {
  const idToken = payload.idToken;
  if (!idToken) {
    return respondJson({ status: "error", message: "Missing idToken" }, headers);
  }

  const verifyUrl = "https://oauth2.googleapis.com/tokeninfo?id_token=" + encodeURIComponent(idToken);
  try {
    const response = UrlFetchApp.fetch(verifyUrl, { muteHttpExceptions: true });
    const code = response.getResponseCode();
    const result = JSON.parse(response.getContentText());

    if (code === 200 && result.sub) {
      return respondJson({
        status: "success",
        user: {
          uid: result.sub,
          email: result.email,
          name: result.name || "",
          picture: result.picture || ""
        }
      }, headers);
    } else {
      return respondJson({ status: "error", message: result.error_description || "Invalid token" }, headers);
    }
  } catch (e) {
    return respondJson({ status: "error", message: e.toString() }, headers);
  }
}

/**
 * 2. Fetch & Combine Short Videos from RapidAPI
 */
function handleGetUnifiedFeed(payload, headers) {
  const region = payload.region || "VN";
  const items = [];
  const now = Date.now();

  // A. Fetch TikTok Feed
  try {
    const ttUrl = "https://tiktok-scraper7.p.rapidapi.com/feed/list?region=" + encodeURIComponent(region) + "&count=12";
    const ttRes = UrlFetchApp.fetch(ttUrl, {
      method: "get",
      headers: {
        "x-rapidapi-key": RAPIDAPI_KEY,
        "x-rapidapi-host": "tiktok-scraper7.p.rapidapi.com"
      },
      muteHttpExceptions: true
    });

    if (ttRes.getResponseCode() === 200) {
      const ttData = JSON.parse(ttRes.getContentText());
      const videoList = (ttData && ttData.data) ? ttData.data : [];
      videoList.forEach(v => {
        const streamUrl = v.play || v.wmplay || (v.video && v.video.play_addr && v.video.play_addr.url_list ? v.video.play_addr.url_list[0] : "");
        if (streamUrl) {
          items.push({
            id: "tt_" + (v.id || v.video_id || Math.random().toString(36).substring(7)),
            platform: "TIKTOK",
            title: v.title || v.desc || "Trending TikTok",
            author: (v.author && (v.author.nickname || v.author.unique_id)) ? (v.author.nickname || v.author.unique_id) : "TikTok Creator",
            avatar: (v.author && (v.author.avatar_thumb || v.author.avatar)) ? (v.author.avatar_thumb || v.author.avatar) : "https://images.unsplash.com/photo-1534528741775-53994a69daeb?w=100&auto=format&fit=crop&q=80",
            thumbnail: v.cover || v.origin_cover || "",
            streamUrl: streamUrl,
            originalUrl: "https://www.tiktok.com/@" + (v.author ? v.author.unique_id : "user") + "/video/" + (v.video_id || v.id || ""),
            likes: v.digg_count || Math.floor(Math.random() * 2500) + 120,
            comments: v.comment_count || Math.floor(Math.random() * 300) + 15,
            fetchedAt: now
          });
        }
      });
    }
  } catch (err) {
    Logger.log("Error fetching TikTok feed: " + err.toString());
  }

  // B. Fetch YouTube Shorts Search
  try {
    const ytUrl = "https://yt-api.p.rapidapi.com/search?query=shorts&type=shorts";
    const ytRes = UrlFetchApp.fetch(ytUrl, {
      method: "get",
      headers: {
        "x-rapidapi-key": RAPIDAPI_KEY,
        "x-rapidapi-host": "yt-api.p.rapidapi.com"
      },
      muteHttpExceptions: true
    });

    if (ytRes.getResponseCode() === 200) {
      const ytData = JSON.parse(ytRes.getContentText());
      const rawYtList = (ytData && ytData.data) ? ytData.data : [];
      // Pick up to 5 shorts to resolve dl streams
      const shortItems = rawYtList.slice(0, 5);

      shortItems.forEach(item => {
        const vidId = item.videoId || item.id;
        if (!vidId) return;

        let streamUrl = "";
        try {
          const dlRes = UrlFetchApp.fetch("https://yt-api.p.rapidapi.com/dl?id=" + encodeURIComponent(vidId), {
            method: "get",
            headers: {
              "x-rapidapi-key": RAPIDAPI_KEY,
              "x-rapidapi-host": "yt-api.p.rapidapi.com"
            },
            muteHttpExceptions: true
          });
          if (dlRes.getResponseCode() === 200) {
            const dlData = JSON.parse(dlRes.getContentText());
            if (dlData && dlData.formats && dlData.formats.length > 0) {
              const mp4Format = dlData.formats.find(f => f.mimeType && f.mimeType.includes("video/mp4") && f.url);
              streamUrl = mp4Format ? mp4Format.url : dlData.formats[0].url;
            }
          }
        } catch (e) {
          Logger.log("DL format error for YT " + vidId + ": " + e.toString());
        }

        items.push({
          id: "yt_" + vidId,
          platform: "YOUTUBE",
          title: item.title || "YouTube Short",
          author: (item.channelTitle || (item.author && item.author.title)) || "YouTube Creator",
          avatar: (item.channelThumbnail && item.channelThumbnail[0] ? item.channelThumbnail[0].url : "") || "https://images.unsplash.com/photo-1535713875002-d1d0cf377fde?w=100&auto=format&fit=crop&q=80",
          thumbnail: (item.thumbnail && item.thumbnail[0] ? item.thumbnail[0].url : "") || "",
          streamUrl: streamUrl || ("https://www.youtube.com/shorts/" + vidId),
          originalUrl: "https://www.youtube.com/shorts/" + vidId,
          likes: Math.floor(Math.random() * 8000) + 500,
          comments: Math.floor(Math.random() * 450) + 30,
          fetchedAt: now
        });
      });
    }
  } catch (err) {
    Logger.log("Error fetching YouTube feed: " + err.toString());
  }

  // Interleave and randomize feed items slightly
  items.sort(() => Math.random() - 0.5);

  return respondJson({
    status: "success",
    count: items.length,
    data: items
  }, headers);
}

/**
 * 3. Extract & Normalize URL (TikTok / Facebook Reel / YouTube Shorts)
 */
function handleExtractUrl(payload, headers) {
  const url = (payload.url || "").trim();
  if (!url) {
    return respondJson({ status: "error", message: "Missing URL parameter" }, headers);
  }

  const now = Date.now();

  // Check 1: TikTok
  if (/tiktok\.com/i.test(url)) {
    try {
      const endpoint = "https://tiktok-scraper7.p.rapidapi.com/?url=" + encodeURIComponent(url);
      const res = UrlFetchApp.fetch(endpoint, {
        method: "get",
        headers: {
          "x-rapidapi-key": RAPIDAPI_KEY,
          "x-rapidapi-host": "tiktok-scraper7.p.rapidapi.com"
        },
        muteHttpExceptions: true
      });

      if (res.getResponseCode() === 200) {
        const body = JSON.parse(res.getContentText());
        const data = body.data || body;
        const stream = data.play || data.wmplay || (data.video && data.video.play_addr && data.video.play_addr.url_list ? data.video.play_addr.url_list[0] : "");

        const resultItem = {
          id: "tt_" + (data.id || data.video_id || Math.random().toString(36).substring(7)),
          platform: "TIKTOK",
          title: data.title || data.desc || "TikTok Short",
          author: (data.author && (data.author.nickname || data.author.unique_id)) ? (data.author.nickname || data.author.unique_id) : "TikTok Creator",
          avatar: (data.author && (data.author.avatar_thumb || data.author.avatar)) ? (data.author.avatar_thumb || data.author.avatar) : "https://images.unsplash.com/photo-1534528741775-53994a69daeb?w=100&auto=format&fit=crop&q=80",
          thumbnail: data.cover || data.origin_cover || "",
          streamUrl: stream,
          originalUrl: url,
          likes: data.digg_count || Math.floor(Math.random() * 1200) + 100,
          comments: data.comment_count || Math.floor(Math.random() * 150) + 10,
          fetchedAt: now
        };

        return respondJson({ status: "success", data: resultItem }, headers);
      } else {
        return respondJson({ status: "error", message: "TikTok API returned status " + res.getResponseCode() }, headers);
      }
    } catch (e) {
      return respondJson({ status: "error", message: "TikTok Extraction Failed: " + e.toString() }, headers);
    }
  }

  // Check 2: Facebook Reel
  if (/facebook\.com|fb\.watch/i.test(url)) {
    try {
      const endpoint = "https://facebook-reel-and-video-downloader.p.rapidapi.com/app/main.php?url=" + encodeURIComponent(url);
      const res = UrlFetchApp.fetch(endpoint, {
        method: "get",
        headers: {
          "x-rapidapi-key": RAPIDAPI_KEY,
          "x-rapidapi-host": "facebook-reel-and-video-downloader.p.rapidapi.com"
        },
        muteHttpExceptions: true
      });

      if (res.getResponseCode() === 200) {
        const data = JSON.parse(res.getContentText());
        const stream = data.hd || data.sd || (data.links && (data.links.hd || data.links.sd)) || "";
        const thumb = data.thumbnail || data.picture || "";

        const resultItem = {
          id: "fb_" + Math.random().toString(36).substring(2, 10),
          platform: "FACEBOOK",
          title: data.title || "Facebook Reel",
          author: data.author || "Facebook Creator",
          avatar: "https://images.unsplash.com/photo-1535713875002-d1d0cf377fde?w=100&auto=format&fit=crop&q=80",
          thumbnail: thumb,
          streamUrl: stream,
          originalUrl: url,
          likes: Math.floor(Math.random() * 3200) + 150,
          comments: Math.floor(Math.random() * 200) + 20,
          fetchedAt: now
        };

        return respondJson({ status: "success", data: resultItem }, headers);
      } else {
        return respondJson({ status: "error", message: "Facebook API returned status " + res.getResponseCode() }, headers);
      }
    } catch (e) {
      return respondJson({ status: "error", message: "Facebook Extraction Failed: " + e.toString() }, headers);
    }
  }

  // Check 3: YouTube Shorts
  if (/youtube\.com\/shorts\/|youtu\.be/i.test(url)) {
    try {
      let vidId = "";
      const matchShorts = url.match(/shorts\/([a-zA-Z0-9_-]+)/);
      if (matchShorts && matchShorts[1]) {
        vidId = matchShorts[1];
      } else {
        const matchYoutu = url.match(/youtu\.be\/([a-zA-Z0-9_-]+)/);
        if (matchYoutu && matchYoutu[1]) vidId = matchYoutu[1];
      }

      if (!vidId) {
        return respondJson({ status: "error", message: "Could not parse YouTube video ID from URL" }, headers);
      }

      const endpoint = "https://yt-api.p.rapidapi.com/dl?id=" + encodeURIComponent(vidId);
      const res = UrlFetchApp.fetch(endpoint, {
        method: "get",
        headers: {
          "x-rapidapi-key": RAPIDAPI_KEY,
          "x-rapidapi-host": "yt-api.p.rapidapi.com"
        },
        muteHttpExceptions: true
      });

      if (res.getResponseCode() === 200) {
        const data = JSON.parse(res.getContentText());
        let stream = "";
        if (data && data.formats && data.formats.length > 0) {
          const mp4Format = data.formats.find(f => f.mimeType && f.mimeType.includes("video/mp4") && f.url);
          stream = mp4Format ? mp4Format.url : data.formats[0].url;
        }

        const thumb = (data.thumbnails && data.thumbnails[0] ? data.thumbnails[0].url : "") || ("https://img.youtube.com/vi/" + vidId + "/hqdefault.jpg");

        const resultItem = {
          id: "yt_" + vidId,
          platform: "YOUTUBE",
          title: data.title || "YouTube Short",
          author: data.channelTitle || data.author || "YouTube Creator",
          avatar: "https://images.unsplash.com/photo-1570295999919-56ceb5ecca61?w=100&auto=format&fit=crop&q=80",
          thumbnail: thumb,
          streamUrl: stream,
          originalUrl: url,
          likes: data.viewCount ? Math.floor(parseInt(data.viewCount) * 0.05) : 1850,
          comments: Math.floor(Math.random() * 220) + 40,
          fetchedAt: now
        };

        return respondJson({ status: "success", data: resultItem }, headers);
      } else {
        return respondJson({ status: "error", message: "YouTube DL API returned status " + res.getResponseCode() }, headers);
      }
    } catch (e) {
      return respondJson({ status: "error", message: "YouTube Extraction Failed: " + e.toString() }, headers);
    }
  }

  return respondJson({ status: "error", message: "Unsupported platform URL. Please provide a TikTok, Facebook Reel, or YouTube Shorts link." }, headers);
}
