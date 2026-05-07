import { NextResponse } from "next/server"

export const runtime = "nodejs"

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url)
  const q = searchParams.get("q")?.trim()
  if (!q || q.length < 2) {
    return NextResponse.json({ status: "failed", reason: "查詢字串太短" })
  }

  const apiKey = process.env.GOOGLE_MAPS_SERVER_KEY
  if (!apiKey) {
    return NextResponse.json({ status: "failed", reason: "Server Google API key 未設定" })
  }

  const body = {
    textQuery: q,
    languageCode: "zh-TW",
    regionCode: "TW",
    pageSize: 1,
  }

  let json: unknown
  try {
    const res = await fetch("https://places.googleapis.com/v1/places:searchText", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Goog-Api-Key": apiKey,
        "X-Goog-FieldMask": "places.id,places.displayName,places.location,places.formattedAddress",
      },
      body: JSON.stringify(body),
    })
    json = await res.json()
  } catch (err) {
    console.error("Google Places error:", err)
    return NextResponse.json({ status: "failed", reason: "Google API 請求失敗" })
  }

  const j = json as {
    places?: Array<{
      id: string
      displayName?: { text: string }
      location?: { latitude: number; longitude: number }
      formattedAddress?: string
    }>
  }

  const place = j.places?.[0]
  if (!place || !place.location) {
    return NextResponse.json({ status: "failed", reason: "找不到此地址或建案名稱" })
  }

  return NextResponse.json({
    status: "success",
    lat: place.location.latitude,
    lng: place.location.longitude,
    displayName: place.displayName?.text ?? null,
    formattedAddress: place.formattedAddress ?? null,
    place_id: place.id,
  })
}
