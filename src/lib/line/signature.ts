import crypto from "node:crypto"

export function verifyLineSignature(body: string, signature: string): boolean {
  const secret = process.env.LINE_CHANNEL_SECRET
  if (!secret) throw new Error("Missing LINE_CHANNEL_SECRET")
  const hmac = crypto.createHmac("SHA256", secret)
  hmac.update(body)
  const expected = hmac.digest("base64")
  return crypto.timingSafeEqual(
    Buffer.from(signature),
    Buffer.from(expected),
  )
}
