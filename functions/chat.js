
const MODEL = "gemini-3.8-flash";

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store"
    }
  });
}

export async function onRequestPost({ request, env }) {
  const apiKey = env.GEMINI_API_KEY;

  if (!apiKey) {
    return json({ error: "Chưa cấu hình Gemini API trên Cloudflare." }, 500);
  }

  if (request.method !== "POST") {
    return json({ error: "Chỉ hỗ trợ POST." }, 405);
  }

  let timer;

  try {
    const body = await request.json();

    // Hỗ trợ cả history của giao diện cũ và messages của giao diện mới.
    const source = Array.isArray(body.history)
      ? body.history
      : Array.isArray(body.messages)
        ? body.messages
        : null;

    let contents = [];

    if (source) {
      if (source.length > 20) {
        return json({ error: "Lịch sử chat quá dài." }, 400);
      }

      contents = source
        .filter(item =>
          item &&
          ["user", "assistant", "model"].includes(item.role) &&
          typeof (item.text ?? item.content) === "string" &&
          (item.text ?? item.content).trim().length > 0 &&
          (item.text ?? item.content).length <= 4000
        )
        .map(item => ({
          role: item.role === "user" ? "user" : "model",
          parts: [{
            text: (item.text ?? item.content).trim()
          }]
        }));
    } else if (
      typeof body.prompt === "string" &&
      body.prompt.trim()
    ) {
      contents = [{
        role: "user",
        parts: [{ text: body.prompt.trim() }]
      }];
    }

    if (!contents.length || contents[0].role !== "user") {
      return json({ error: "Nội dung câu hỏi không hợp lệ." }, 400);
    }

    const controller = new AbortController();
    timer = setTimeout(() => controller.abort(), 20000);

    const response = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:generateContent`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-goog-api-key": apiKey.trim()
        },
        body: JSON.stringify({
          contents,
          generationConfig: { maxOutputTokens: 1024 }
        }),
        signal: controller.signal
      }
    );

    if (!response.ok) {
      const detail = await response.text();
      console.error("Gemini HTTP", response.status, detail.slice(0, 1000));

      return json({
        error: response.status === 400
          ? "Gemini từ chối yêu cầu. Hãy kiểm tra model và nội dung gửi."
          : response.status === 404
            ? "Không tìm thấy model Gemini được cấu hình."
            : response.status === 429
              ? "Gemini đã đạt giới hạn sử dụng. Hãy thử lại sau."
              : "Dịch vụ Gemini đang gặp lỗi."
      }, 502);
    }

    const data = await response.json();
    const reply = data.candidates?.[0]?.content?.parts
      ?.map(part => part.text || "")
      .join("")
      .trim();

    if (!reply) {
      return json({ error: "Gemini chưa trả về nội dung." }, 502);
    }

    return json({
      choices: [{
        message: { role: "assistant", content: reply }
      }]
    });
  } catch (error) {
    console.error("Chat error:", error.message);

    return json({
      error: error.name === "AbortError"
        ? "AI phản hồi quá lâu."
        : "Không thể xử lý yêu cầu chat."
    }, error.name === "AbortError" ? 504 : 500);
  } finally {
    if (timer) clearTimeout(timer);
  }
}
