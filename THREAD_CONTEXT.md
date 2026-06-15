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

- GitHub CLI(`gh`)는 현재 PC PATH에서 인식되지 않습니다.
- GitHub 커넥터에는 새 저장소 생성 도구가 노출되어 있지 않습니다.
- `https://github.com/jaeminiz/worpl-message-reader.git` 원격은 확인 시점에 존재하지 않습니다.
- 로컬 Git 원격 `origin`은 `https://github.com/jaeminiz/worpl-message-reader.git`로 추가했습니다.
- `git push -u origin main` 시도 결과, GitHub가 `Repository not found`를 반환했습니다.
- GitHub CLI는 `winget install --id GitHub.cli -e --source winget`으로 설치했습니다.
- 설치 경로는 `C:\Program Files\GitHub CLI\gh.exe`입니다. 현재 PowerShell 세션 PATH에는 아직 반영되지 않아 전체 경로로 실행했습니다.
- `gh auth status` 결과, 아직 GitHub CLI 로그인은 되어 있지 않습니다.
- Codex 인앱 브라우저로 GitHub 새 저장소 생성 화면을 열었으나, GitHub 로그인 화면으로 이동했습니다.
- GitHub 공개 저장소 연결을 계속하려면 아래 둘 중 하나가 필요합니다.
  1. GitHub에서 `jaeminiz/worpl-message-reader` 공개 저장소를 먼저 생성
  2. GitHub CLI 로그인 후 `gh repo create jaeminiz/worpl-message-reader --public --source . --remote origin --push` 실행 가능 상태 만들기

## 다음 작업 후보

1. GitHub 공개 저장소 생성
2. `git push -u origin main`
3. 필요 시 기존 `worpl-clone-platform`에서 `tools/worpl-message-reader` 제거 또는 archive 처리

## 검증 명령

```powershell
npm test
npm run build
```
