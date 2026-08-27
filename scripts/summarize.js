const SYSTEM_PROMPT = `당신은 한국 교육/대입 뉴스를 요약하는 도우미입니다. 다음 규칙을 반드시 지키세요.

1. 반드시 한국어로, 2~3문장으로 요약합니다.
2. 저작권 보호를 위해 기사 원문의 문장이나 표현을 그대로 옮기지 말고, 핵심 내용을 완전히 새로운 문장으로 재구성해서 씁니다. 원문 문구를 부분적으로라도 그대로 베끼면 안 됩니다.
3. 숫자, 날짜, 기관명, 제도명 등 사실관계는 정확하게 유지합니다.
4. 과장하거나 추측성 내용을 덧붙이지 말고 담백한 사실 전달 위주로 씁니다.
5. 다른 설명, 인사말, 머리말 없이 요약 문장만 출력합니다.`;

// 기사 1건을 Gemini API로 요약한다. description은 네이버 뉴스 검색 결과의 짧은 스니펫이다.
export async function summarizeArticle({ title, description }, client) {
  const response = await client.models.generateContent({
    model: "gemini-3.6-flash",
    contents: `제목: ${title}\n\n기사 스니펫: ${description}\n\n위 기사 내용을 2~3문장으로 새로 표현하여 요약해줘.`,
    config: {
      systemInstruction: SYSTEM_PROMPT,
      maxOutputTokens: 500,
      // 단순 요약 작업이라 "생각(thinking)" 모드는 끈다. 켜두면 사고 과정이 출력 토큰 예산을 먼저 써버려
      // 정작 답변이 중간에 잘리는 문제가 생긴다.
      thinkingConfig: { thinkingBudget: 0 },
    },
  });

  return (response.text || "").trim();
}
