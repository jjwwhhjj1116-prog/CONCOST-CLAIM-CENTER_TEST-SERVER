# 베트남 메인 서버 `.env` 암호화 전달

## 결론

실제 `.env`는 최종 서버 연결 때 전달하되, 소스 ZIP·Git·메신저 첨부에 평문으로 넣지 않는다. 베트남 서버 담당자의 RSA 공개키로 별도 암호화한 `*.vietnam-env.enc.json` 파일을 소스 전달물 옆에 제공한다. 개인키는 베트남 서버 밖으로 반출하지 않는다.

## 1. 베트남 서버에서 수신 키 생성

베트남 담당자가 최종 서버에서 실행한다.

```bash
openssl genpkey -algorithm RSA -pkeyopt rsa_keygen_bits:3072 -out vietnam-env-private.pem
chmod 600 vietnam-env-private.pem
openssl pkey -in vietnam-env-private.pem -pubout -out vietnam-env-public.pem
```

개발팀에는 `vietnam-env-public.pem`만 전달한다. `vietnam-env-private.pem`은 보내지 않는다.

## 2. 개발팀에서 운영 env 작성·검증

`.env.vietnam.example`을 `.env.vietnam.local`로 복사해 실제 값을 입력한다. `.local` 파일은 Git 제외 대상이다.

```powershell
npm run vietnam:env:validate -- --env .env.vietnam.local
```

검사는 secret 값을 출력하지 않으며 운영 모드, 절대 볼륨 경로, 정확한 HTTPS origin, 서로 고정 보관할 Google/AI 32바이트 암호화 키, 참조 변수, Google REAL 모드를 확인한다.

## 3. 공개키로 암호화 패키지 생성

```powershell
npm run vietnam:env:encrypt -- --env .env.vietnam.local --public-key vietnam-env-public.pem --out deliverables/CONCOST_YYYYMMDD.vietnam-env.enc.json
```

패키지는 RSA-OAEP-SHA256으로 일회용 AES 키를 감싸고, `.env` 본문은 AES-256-GCM으로 인증 암호화한다. 암호화 파일과 소스 ZIP은 함께 전달해도 되지만, 평문 `.env`와 개인키는 전달물에 넣지 않는다.

## 4. 베트남 서버에서 복호화

```bash
npm run vietnam:env:decrypt -- --package CONCOST_YYYYMMDD.vietnam-env.enc.json --private-key vietnam-env-private.pem --out .env.received
chmod 600 .env.received
```

기존 운영 `.env`는 자동으로 덮어쓰지 않는다. 담당자가 기존 값과 병합·검토하고 백업한 뒤에만 `.env`로 교체한다. 이후 `/readiness`, 로그인, Google Drive, AI 3종 연결 상태를 확인한다.

## 주간 소스 업데이트

주간 소스 ZIP에는 `.env`를 다시 넣지 않는다. 기존 운영 `.env`, DB, Google credential vault와 master key를 그대로 보존한다. 신규 secret 추가나 승인된 키 회전이 있을 때만 새 암호화 패키지를 별도로 생성한다.
