# 릴리스 체크리스트

릴리스 담당자가 배포 바이너리를 만들기 전에 확인해야 하는 절차를 정리한 문서입니다.

## GeoIP 데이터베이스

국가 단위 접속 허용·차단 판정(`src/server/security/GeoFilter.ts`)은 `geoip-lite` 가 동봉한 GeoLite2 데이터를 읽습니다. 배포 바이너리에는 `node_modules/geoip-lite/data/geoip-country.dat` 과 `geoip-country6.dat` 두 파일만 들어가며, city DB 는 들어가지 않습니다. 국가 단위 판정만 수행하기 때문이고, city DB 를 넣으면 플랫폼 바이너리 다섯 개가 각각 100MB 가까이 커지기 때문입니다.

MaxMind 라이선스 키를 보유하고 있다면 릴리스 전에 다음 명령으로 데이터를 갱신합니다.

```
MAXMIND_LICENSE_KEY=<키> npm run geoip:update
```

키가 없으면 갱신하지 않고 패키지가 동봉한 DB 를 그대로 사용하며, 수개월 수준의 오차를 허용합니다. 이때 `npm run geoip:update` 는 종료 코드 2 로 끝나고 stderr 에 `MAXMIND_LICENSE_KEY is not set; keeping the bundled GeoLite2 database` 를 남깁니다. 종료 코드 2 는 "갱신하지 않았다" 를 뜻하며, 실제 갱신 실패를 뜻하는 1 과 구분됩니다.

데이터를 갱신한 뒤에는 반드시 아래 두 명령을 다시 실행해야 새 DB 가 바이너리 안으로 들어갑니다. 갱신만 하고 재빌드하지 않으면 이전 DB 를 담은 바이너리가 그대로 배포됩니다.

```
npm run build && npm run pkg
```

## 고지

GeoLite2 데이터베이스는 Creative Commons Attribution-ShareAlike 4.0 International License 를 따르며, attribution 을 요구합니다. `node_modules/geoip-lite/LICENSE`(패키지 README 의 License 절이 가리키는 파일)의 `DATABASES LICENSE (GeoLite2 databases)` 절이 요구하는 문구는 다음과 같습니다.

```
The attribution requirement may be met by including the following in all
advertising and documentation mentioning features of or use of this
database:

This product includes GeoLite2 data created by MaxMind, available from
<a href="http://www.maxmind.com">http://www.maxmind.com</a>.
```

배포물의 고지 문서에도 위 문구를 그대로 포함해야 합니다. 요약하거나 바꿔 쓰지 않습니다.

## 확인란

- [ ] `MAXMIND_LICENSE_KEY` 를 사용해 GeoIP 데이터를 갱신했다. 키가 없어 갱신하지 않았다면 동봉 DB 를 그대로 쓴다는 사실을 릴리스 노트에 적었다.
- [ ] 데이터를 갱신한 뒤 `npm run build && npm run pkg` 를 다시 실행해 바이너리를 재생성했다.
- [ ] 배포물의 고지 문서에 위 MaxMind GeoLite2 attribution 문구를 그대로 포함했다.
