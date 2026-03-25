# quote-page

獨立部署的 GDS 快速報價（Quote）前端，由 `gds-mission-mock` 內的 `quote-standalone` 複製並維護為獨立專案。

## 開發

```bash
npm install
cp .env.example .env.local   # 依說明填入 Supabase 等變數
npm run dev                  # 預設 http://localhost:3001
```

## 建置

```bash
npm run build
npm start
```

## 環境變數

見 `.env.example`（Supabase、選用 CWA 天氣 API）。

## 授權與來源

與上游 LAOP / GDS 專案一致；本 repo 為報價模組之獨立副本。
