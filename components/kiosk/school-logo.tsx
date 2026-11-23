/**
 * 학교 로고 (public/favicon.svg와 같은 그림).
 * <img src="/favicon.svg">로 받으면 느린 망·다른 파일을 받는 중에는 늦게 뜨고, 뜨기 전에는 크기가 0이라
 * 관리자 모드로 들어가는 길게 누르기 자리도 사라진다. 그래서 페이지에 바로 그려 넣는다.
 */
export function SchoolLogo({ className }: { className?: string }) {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 337.71 257" aria-hidden className={className}>
      <path fill="#003e9c" d="m0 0 .71 257h81.74l-.74-176L0 0z" />
      <path fill="#0068bb" d="M0 0h176.71l79 81h-174" />
      <path fill="#ffb700" d="M255.71 0h82v81h-82z" />
      <path fill="#8ed3f5" d="M255.69 81 82.45 257h92.26" />
      <path fill="#00a9ee" d="m255.69 81 1.03 176h-83.67" />
      <path fill="#0068b7" d="m255.69 81 82.02 81.48V257h-80.99" />
    </svg>
  );
}
