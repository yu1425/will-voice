/**
 * うぃるの返答生成ロジック
 * ============================================================
 * generateWillReply(userMessage) を呼ぶと、うぃるの返答テキストを返します。
 *
 * 【今回の無料MVP】
 *   外部AI API は使わず、lib/mockReplyRules.ts のFAQルールから返答します。
 *   キーワード一致で、一番「具体的(=一致したキーワードが長い)」ルールを選びます。
 *   これにより、ルールの並び順に神経質にならなくても自然に動きます。
 *
 * 【将来の差し替えポイント】★ここをAPI呼び出しに置き換えるだけでOK★
 *   この関数のシグネチャ (userMessage: string) => Promise<string> を保ったまま、
 *   中身を Claude API / OpenAI API の呼び出しに差し替えられます。
 *   UI側 (app/page.tsx) は一切変更しなくて済む設計です。
 *
 *   推奨構成(APIキーをブラウザに出さない):
 *     1. app/api/reply/route.ts を作る(サンプル: app/api/reply/route.ts.example)
 *     2. この関数を fetch("/api/reply", ...) を呼ぶだけにする
 *     3. サーバー側で WILL_SYSTEM_PROMPT と userMessage(+会話履歴)をAIに渡す
 *     4. APIキーは .env.local で管理する
 *
 *   例(将来のフロント側 generateWillReply のイメージ):
 *     export async function generateWillReply(
 *       userMessage: string,
 *       history: { role: "user" | "will"; text: string }[] = []
 *     ): Promise<string> {
 *       const res = await fetch("/api/reply", {
 *         method: "POST",
 *         headers: { "Content-Type": "application/json" },
 *         body: JSON.stringify({ userMessage, history }),
 *       });
 *       if (!res.ok) return findMockReply(userMessage); // 失敗時はモックにフォールバック
 *       const data = await res.json();
 *       return data.reply as string;
 *     }
 */

import { MOCK_REPLY_RULES, FALLBACK_REPLY } from "./mockReplyRules";
import { WILL_GREETING } from "./willPrompt";

/**
 * 入力にマッチするモック返答を探す。
 * 複数ルールに一致した場合は、一致キーワードが最も長い(=具体的な)ものを優先する。
 * 何も一致しなければ FALLBACK_REPLY を返す。
 */
export function findMockReply(userMessage: string): string {
  const text = userMessage.trim();
  if (text.length === 0) {
    return WILL_GREETING;
  }

  // 英語キーワード(LINE / PayPay / help など)も拾えるよう小文字化して比較
  const haystack = text.toLowerCase();

  let bestReply: string | null = null;
  let bestLen = 0;

  for (const rule of MOCK_REPLY_RULES) {
    for (const kw of rule.keywords) {
      if (haystack.includes(kw.toLowerCase()) && kw.length > bestLen) {
        bestLen = kw.length;
        bestReply = rule.reply;
      }
    }
  }

  return bestReply ?? FALLBACK_REPLY;
}

/**
 * うぃるの返答を生成する。
 *
 * @param userMessage ユーザーが話した(入力した)テキスト
 * @returns うぃるの返答テキスト
 */
export async function generateWillReply(userMessage: string): Promise<string> {
  // ★★★ 将来の差し替えポイント ★★★
  // ここを Claude / OpenAI API 呼び出しに置き換えてください。
  // (ファイル冒頭のコメントにサンプルあり)

  // --- 今はモック返答 ---
  // 実際のAPIっぽい「少し待つ」体験を再現するため、軽いディレイを入れています。
  await new Promise((resolve) => setTimeout(resolve, 500));
  return findMockReply(userMessage);
}
