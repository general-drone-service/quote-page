import { messagingApi } from "@line/bot-sdk"
import type { QuoteSummary } from "./types"

export function buildQuoteFlexBubble(summary: QuoteSummary): messagingApi.FlexBubble {
  return {
    type: "bubble",
    size: "mega",
    header: {
      type: "box",
      layout: "vertical",
      backgroundColor: "#27272A",
      paddingAll: "16px",
      contents: [
        {
          type: "text",
          text: "GDS 低空作業報價單",
          color: "#FFFFFF",
          weight: "bold",
          size: "md",
        },
        {
          type: "text",
          text: summary.quoteCode,
          color: "#A1A1AA",
          size: "xs",
          margin: "sm",
        },
      ],
    },
    body: {
      type: "box",
      layout: "vertical",
      spacing: "md",
      paddingAll: "16px",
      contents: [
        {
          type: "box",
          layout: "horizontal",
          contents: [
            {
              type: "text",
              text: "報價總額",
              color: "#71717A",
              size: "sm",
              flex: 1,
            },
            {
              type: "text",
              text: `NTD ${summary.totalNtd.toLocaleString()}`,
              color: "#2563EB",
              weight: "bold",
              size: "lg",
              flex: 2,
              align: "end",
            },
          ],
        },
        {
          type: "box",
          layout: "horizontal",
          contents: [
            {
              type: "text",
              text: "預估工期",
              color: "#71717A",
              size: "sm",
              flex: 1,
            },
            {
              type: "text",
              text: `${summary.suggestedDays} 天`,
              color: "#18181B",
              weight: "bold",
              size: "md",
              flex: 2,
              align: "end",
            },
          ],
        },
        {
          type: "box",
          layout: "horizontal",
          contents: [
            {
              type: "text",
              text: "有效至",
              color: "#71717A",
              size: "xs",
              flex: 1,
            },
            {
              type: "text",
              text: summary.validUntil,
              color: "#71717A",
              size: "xs",
              flex: 2,
              align: "end",
            },
          ],
        },
        {
          type: "separator",
          margin: "md",
        },
        {
          type: "text",
          text: "⚠️ 本報價為快速估算，正式報價需現場勘查確認。",
          color: "#92400E",
          size: "xxs",
          wrap: true,
          margin: "md",
        },
      ],
    },
    footer: {
      type: "box",
      layout: "vertical",
      paddingAll: "12px",
      contents: [
        {
          type: "button",
          action: {
            type: "uri",
            label: "下載報價單 PDF",
            uri: summary.pdfUrl,
          },
          style: "primary",
          color: "#2563EB",
        },
      ],
    },
  }
}
