export async function onRequestPost(context) {
  try {
    const apiKey = context.env.GEMINI_API_KEY || context.env.OPENAI_API_KEY;
    if (!apiKey) {
      return new Response(
        JSON.stringify({ error: "Chưa cấu hình API Key trên Cloudflare." }),
        { status: 500, headers: { "Content-Type": "application/json; charset=utf-8" } }
      );
    }

    const requestData = await context.request.json();
    let geminiContents = [];

    if (requestData.messages && Array.isArray(requestData.messages) && requestData.messages.length > 0) {
      geminiContents = requestData.messages
        .filter(msg => msg.content && typeof msg.content === 'string' && msg.content.trim() !== '')
        .map(msg => ({
          role: msg.role === "user" ? "user" : "model",
          parts: [{ text: msg.content.trim() }]
        }));
    }

    if (geminiContents.length === 0) {
      const userText = (requestData.prompt && typeof requestData.prompt === 'string' && requestData.prompt.trim() !== '') 
        ? requestData.prompt.trim() 
        : "Xin chào!";
      geminiContents = [{ role: "user", parts: [{ text: userText }] }];
    }

    const geminiUrl = "https://generativelanguage.googleapis.com/v1beta/models/gemini-3.8-flash:generateContent";

    // Thêm AbortController để giới hạn thời gian chờ tối đa 15 giây tránh bị treo
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 15000);

    const apiResponse = await fetch(geminiUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-goog-api-key": apiKey.trim()
      },
      body: JSON.stringify({ contents: geminiContents }),
      signal: controller.signal
    });

    clearTimeout(timeoutId);
    const data = await apiResponse.json();

    let replyText = "AI phản hồi quá lâu, bạn thử lại nhé.";
    if (data.candidates && data.candidates[0]?.content?.parts[0]?.text) {
      replyText = data.candidates[0].content.parts[0].text;
    } else if (data.error) {
      replyText = `Lỗi Gemini API: ${data.error.message}`;
    }

    return new Response(
      JSON.stringify({
        choices: [{ message: { role: "assistant", content: replyText } }]
      }),
      {
        status: 200,
        headers: {
          "Content-Type": "application/json; charset=utf-8",
          "Access-Control-Allow-Origin": "*"
        }
      }
    );

  } catch (err) {
    let errorMsg = err.name === 'AbortError' ? "Thời gian phản hồi quá hạn (Timeout)." : err.message;
    return new Response(
      JSON.stringify({
        choices: [{ message: { role: "assistant", content: `Lỗi kết nối server: ${errorMsg}` } }]
      }),
      { status: 200, headers: { "Content-Type": "application/json; charset=utf-8", "Access-Control-Allow-Origin": "*" } }
    );
  }
}
