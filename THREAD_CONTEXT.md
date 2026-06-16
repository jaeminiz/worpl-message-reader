# Codex Thread Context

이 문서는 기존 `worpl-clone-platform` 안에서 개발되던 WORPL 쪽지 오토클릭 앱을 독립 프로젝트로 분리한 작업 맥락입니다.

## 독립 프로젝트

- 새 폴더: `D:\INBOX_WP\98. CODEX\worpl-message-reader`
- 앱 이름: WORPL 쪽지 오토클릭 / WORPL Message Reader
- 현재 버전: 0.1.4
- 제작자: 박재민 <jaemini@gmail.com>
- 기본 브랜치: `main`
- 첫 커밋: `b5cfcb4 Initial standalone WORPL message reader project`

## 분리 작업 결과

- `src/`, `test/`, `MANUAL.md`, `VERSION_HISTORY.md`를 독립 프로젝트로 복사했습니다.
- 루트 기준 `package.json`, `package-lock.json`, `.gitignore`, `electron-builder.json`, `README.md`, `AGENTS.md`를 새로 구성했습니다.
- `dist/`와 `node_modules/`는 Git 커밋에서 제외했습니다.
- 새 프로젝트에서 `npm install`, `npm test`, `npm run build` 검증을 완료했습니다.
- 설치 파일: `dist\WORPL Message Reader Setup 0.1.4.exe`

## GitHub 진행 상태

- GitHub 공개 저장소 생성 완료: `https://github.com/jaeminiz/worpl-message-reader`
- 로컬 Git 원격 `origin`: `https://github.com/jaeminiz/worpl-message-reader.git`
- `git push -u origin main` 성공, 로컬 `main`은 `origin/main`을 추적합니다.
- GitHub API 확인 결과, `jaeminiz/worpl-message-reader`는 `public` 저장소이고 기본 브랜치는 `main`입니다.
- GitHub CLI는 `winget install --id GitHub.cli -e --source winget`으로 설치했습니다.
- 설치 경로는 `C:\Program Files\GitHub CLI\gh.exe`입니다. 현재 PowerShell 세션 PATH에는 아직 반영되지 않아 전체 경로로 실행했습니다.
- GitHub CLI 로그인은 완료하지 않았습니다. 이번 연결은 인앱 브라우저에서 저장소를 생성한 뒤 로컬 `git push`로 완료했습니다.

## 다음 작업 후보

1. 필요 시 기존 `worpl-clone-platform`에서 `tools/worpl-message-reader` 제거 또는 archive 처리
2. GitHub 저장소 설명, 토픽, 릴리스 태그 등 공개 저장소 메타데이터 정리

## 검증 명령

```powershell
npm test
npm run build
```
