/**
 * CSV 셀 하나를 직렬화한다.
 * 엑셀·구글 시트는 =, +, -, @, 탭, CR로 시작하는 셀을 수식으로 실행하므로(CSV 수식 주입)
 * 문자열이면 앞에 '를 붙여 일반 텍스트로 만든다. 숫자는 그대로 둔다.
 */
export function csvCell(v: unknown): string {
  let s = String(v ?? "");
  if (typeof v === "string" && /^[=+\-@\t\r]/.test(s)) s = `'${s}`;
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}
