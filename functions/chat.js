
const MODEL = "gemini-2.5-flash";
const API_URL =
  `https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:generateContent`;

function jsonResponse(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store"
    }
  });
}

export async function onRequestPost({ request, env }) {
  // Chỉ cho phép gọi từ chính website.
  const origin = request.headers.get("Origin");

  if (origin) {
    try {
      if (new URL(origin).origin !== new URL(request.url).origin) {
        return jsonResponse({ error: "Nguồn yêu cầu không hợp lệ." }, 403);
      }
    } catch {
      return jsonResponse({ error: "Origin không hợp lệ." }, 403);
    }
  }

  // API key chỉ được lưu trong Cloudflare Secret.
  const apiKey = env.GEMINI_API_KEY;

  if (!apiKey) {
    return jsonResponse({
      error: "Chưa cấu hình GEMINI_API_KEY trên Cloudflare."
    }, 500);
  }

  if (request.method !== "POST") {
    return jsonResponse({ error: "Phương thức không được hỗ trợ." }, 405);
  }

  let timer;

  try {
    const contentType = request.headers.get("Content-Type") || "";

    if (!contentType.includes("application/json")) {
      return jsonResponse({ error: "Yêu cầu phải có định dạng JSON." }, 415);
    }

    // Giới hạn kích thước body để tránh yêu cầu quá lớn.
    const contentLength = Number(request.headers.get("Content-Length") || 0);

    if (contentLength > 32000) {
      return jsonResponse({ error: "Dữ liệu gửi lên quá lớn." }, 413);
    }

    const body = await request.json();
    let messages = [];

    if (Array.isArray(body.messages)) {
      if (body.messages.length > 20) {
        return jsonResponse({
          error: "Lịch sử trò chuyện vượt quá giới hạn."
        }, 400);
      }

      messages = body.messages
        .filter(
          item =>
            item &&
            ["user", "assistant", "model"].includes(item.role) &&
            typeof item.content === "string" &&
            item.content.trim().length > 0 &&
            item.content.length <= 4000
        )
        .map(item => ({
          role: item.role === "user" ? "user" : "model",
          parts: [{ text: item.content.trim() }]
        }));
    } else if (
      typeof body.prompt === "string" &&
      body.prompt.trim().length > 0 &&
      body.prompt.length <= 4000
    ) {
      messages = [{
        role: "user",
        parts: [{ text: body.prompt.trim() }]
      }];
    }

    if (messages.length === 0) {
      return jsonResponse({
        error: "Không tìm thấy nội dung câu hỏi hợp lệ."
      }, 400);
    }

    // Gemini yêu cầu tin nhắn đầu tiên phải là user.
    if (messages[0].role !== "user") {
      return jsonResponse({
        error: "Lịch sử trò chuyện không hợp lệ."
      }, 400);
    }

    const controller = new AbortController();

    timer = setTimeout(() => controller.abort(), 20000);

    const apiResponse = await fetch(API_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-goog-api-key": apiKey.trim()
      },
      body: JSON.stringify({
        contents: messages,
        generationConfig: {
          maxOutputTokens: 1024,
          temperature: 0.7
        }
      }),
      signal: controller.signal
    });

    if (!apiResponse.ok) {
      // Không trả thông tin nội bộ hoặc API key cho trình duyệt.
      console.error("Gemini API trả về HTTP:", apiResponse.status);

      if (apiResponse.status === 400) {
        return jsonResponse({
          error: "Yêu cầu gửi đến Gemini không hợp lệ."
        }, 400);
      }

      if (apiResponse.status === 401 || apiResponse.status === 403) {
        return jsonResponse({
          error: "API key hoặc quyền truy cập Gemini chưa hợp lệ."
        }, 502);
      }

      if (apiResponse.status === 404) {
        return jsonResponse({
          error: "Không tìm thấy model Gemini. Hãy kiểm tra tên model."
        }, 502);
      }

      if (apiResponse.status === 429) {
        return jsonResponse({
          error: "Gemini đang quá tải hoặc đã đạt giới hạn sử dụng."
        }, 429);
      }

      return jsonResponse({
        error: "Dịch vụ AI đang gặp sự cố. Hãy thử lại sau."
      }, 502);
    }

    const result = await apiResponse.json();

    const reply = result.candidates?.[0]?.content?.parts
      ?.map(part => part.text || "")
      .join("")
      .trim();

    if (!reply) {
      return jsonResponse({
        error: "Gemini chưa tạo được câu trả lời."
      }, 502);
    }

    // Giữ định dạng mà giao diện chat hiện tại có thể đang sử dụng.
    return jsonResponse({
      choices: [{
        message: {
          role: "assistant",
          content: reply
        }
      }]
    });
  } catch (error) {
    if (error.name === "AbortError") {
      return jsonResponse({
        error: "AI phản hồi quá lâu. Bạn hãy thử lại."
      }, 504);
    }

    console.error("Chat Function error:", error.message);

    return jsonResponse({
      error: "Không thể kết nối với dịch vụ AI."
    }, 500);
  } finally {
    if (timer) clearTimeout(timer);
  }
}
