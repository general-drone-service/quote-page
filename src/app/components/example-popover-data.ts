// Example descriptions & placeholder image configs for popover tooltips

export interface ExampleInfo {
  title: string
  description: string
  imageBg: string    // tailwind bg class (gradient or solid)
  imageIcon: string  // emoji for placeholder
}

// ─── Dirt types ─────────────────────────────────────────────────────────────

export const DIRT_EXAMPLES: Record<string, ExampleInfo> = {
  dust: {
    title: "灰塵",
    description: "一般環境累積的灰塵與懸浮微粒，常見於都市商辦及住宅外牆。清洗難度最低。",
    imageBg: "bg-gradient-to-br from-stone-300 to-stone-400",
    imageIcon: "💨",
  },
  scale: {
    title: "水垢",
    description: "硬水長期流經外牆留下的白色�ite鈣質沉積，常見於窗沿下方及冷氣排水處。需酸性清潔劑處理。",
    imageBg: "bg-gradient-to-br from-amber-200 to-yellow-400",
    imageIcon: "🟤",
  },
  mold: {
    title: "黑黴",
    description: "潮濕面長期滋生的黴菌斑，常見於背陽面及排水不良處。需專用殺菌清潔劑，避免復發。",
    imageBg: "bg-gradient-to-br from-green-700 to-green-900",
    imageIcon: "🟢",
  },
  bird: {
    title: "鳥屎",
    description: "鳥類排泄物堆積，具腐蝕性，常見於頂樓女兒牆及冷氣主機平台。需先軟化再沖洗。",
    imageBg: "bg-gradient-to-br from-gray-200 to-gray-400",
    imageIcon: "🐦",
  },
  exhaust: {
    title: "排煙汙垢",
    description: "餐廳、工廠排煙口附近的油煙碳化物。呈黑灰色黏附性強，需鹼性去油劑浸泡處理。",
    imageBg: "bg-gradient-to-br from-gray-600 to-gray-800",
    imageIcon: "🏭",
  },
  grease: {
    title: "機械油汙",
    description: "工業設備或機房漏油造成的深層油污。清洗難度最高，需強效去油劑搭配高壓熱水沖洗。",
    imageBg: "bg-gradient-to-br from-zinc-700 to-zinc-900",
    imageIcon: "⚫",
  },
}

// ─── Complexity ─────────────────────────────────────────────────────────────

export const COMPLEXITY_EXAMPLES: Record<string, ExampleInfo> = {
  light: {
    title: "輕微",
    description: "外牆平整、少量窗框，無大面積凸出物。吊籠作業順暢，清洗效率最高。",
    imageBg: "bg-gradient-to-br from-sky-100 to-sky-200",
    imageIcon: "🏢",
  },
  medium: {
    title: "中等",
    description: "窗框、冷氣室外機、線條裝飾較多。需繞行障礙物，作業時間增加約 20%。",
    imageBg: "bg-gradient-to-br from-amber-100 to-amber-300",
    imageIcon: "🏬",
  },
  heavy: {
    title: "複雜",
    description: "大量格柵、鋁包板、裝飾線條或不規則造型。需多次調整吊籠角度，工時顯著增加。",
    imageBg: "bg-gradient-to-br from-red-100 to-red-300",
    imageIcon: "🏗️",
  },
}

// ─── Cleaning agents ────────────────────────────────────────────────────────

export const CLEANING_AGENT_EXAMPLES: Record<string, ExampleInfo> = {
  soft: {
    title: "柔洗（快速噴洗）",
    description: "低壓水柱快速噴洗，適合灰塵等輕度汙染。速度最快、成本最低，但對頑固汙垢效果有限。",
    imageBg: "bg-gradient-to-br from-cyan-100 to-cyan-200",
    imageIcon: "🚿",
  },
  standard: {
    title: "淨洗（高壓水洗）",
    description: "高壓水柱沖洗，可去除大部分水垢與中度汙垢。為最常見的標準清潔方式。",
    imageBg: "bg-gradient-to-br from-blue-200 to-blue-400",
    imageIcon: "💦",
  },
  deep: {
    title: "精洗（中性清潔劑）",
    description: "搭配中性或專用清潔劑刷洗，適合黑黴、油汙等頑固汙染。效果最佳但單價較高。",
    imageBg: "bg-gradient-to-br from-violet-200 to-violet-400",
    imageIcon: "🧴",
  },
}
