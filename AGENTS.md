# Project Instructions

이 저장소는 WORPL 쪽지 오토클릭 Windows 데스크톱 앱의 독립 프로젝트입니다.

## Working Rules

- WORPL 운영 사이트를 변경하지 않습니다.
- 자동화는 사용자가 로그인한 전용 Chrome 창에서만 수행합니다.
- 엑셀에는 `순번`, `Date`, `작성자`, `제목`, `링크`만 저장합니다.
- 본문, 계정 정보, 쿠키, 개인정보 원문, 업무상 민감정보는 저장소에 커밋하지 않습니다.
- 설치 파일과 빌드 산출물은 `dist/`에 두되 Git에는 포함하지 않습니다.

## Validation

```powershell
npm test
npm run build
```
