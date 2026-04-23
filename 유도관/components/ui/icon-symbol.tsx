// Fallback for using MaterialIcons on Android and web.

import MaterialIcons from "@expo/vector-icons/MaterialIcons";
import { SymbolWeight, SymbolViewProps } from "expo-symbols";
import { ComponentProps } from "react";
import { OpaqueColorValue, type StyleProp, type TextStyle } from "react-native";

type IconMapping = Record<SymbolViewProps["name"], ComponentProps<typeof MaterialIcons>["name"]>;
type IconSymbolName = keyof typeof MAPPING;

/**
 * SF Symbols to Material Icons mappings for OnboardPro app.
 */
const MAPPING = {
  // Navigation
  "house.fill": "home",
  "paperplane.fill": "send",
  "chevron.left.forwardslash.chevron.right": "code",
  "chevron.right": "chevron-right",
  "chevron.left": "chevron-left",
  "xmark": "close",

  // Onboarding / Checklist
  "checklist": "checklist",
  "checkmark.circle.fill": "check-circle",
  "checkmark.circle": "radio-button-unchecked",
  "circle": "radio-button-unchecked",
  "checkmark": "check",

  // Documents
  "doc.fill": "description",
  "doc.text.fill": "article",
  "doc.badge.plus": "note-add",
  "paperclip": "attach-file",
  "arrow.up.doc.fill": "upload-file",

  // Training / Education
  "graduationcap.fill": "school",
  "play.circle.fill": "play-circle",
  "calendar": "calendar-today",
  "clock.fill": "access-time",
  "clock": "schedule",

  // Approval / Status
  "checkmark.seal.fill": "verified",
  "xmark.seal.fill": "cancel",
  "hourglass": "hourglass-empty",
  "bell.fill": "notifications",
  "creditcard.fill": "credit-card",
  "bell": "notifications-none",
  "bell.badge.fill": "notifications-active",

  // People / HR
  "person.fill": "person",
  "person.2.fill": "group",
  "person.badge.plus": "person-add",
  "person.crop.circle.fill": "account-circle",
  "person.3.fill": "groups",

  // Settings / Profile
  "gearshape.fill": "settings",
  "slider.horizontal.3": "tune",
  "square.and.pencil": "edit",
  "trash.fill": "delete",
  "plus.circle.fill": "add-circle",
  "plus": "add",
  "minus": "remove",

  // Dashboard / Charts
  "chart.bar.fill": "bar-chart",
  "chart.pie.fill": "pie-chart",
  "list.bullet": "list",
  "square.grid.2x2.fill": "grid-view",

  // Status
  "exclamationmark.triangle.fill": "warning",
  "info.circle.fill": "info",
  "arrow.clockwise": "refresh",
  "arrow.right": "arrow-forward",
  "arrow.left": "arrow-back",

  // QR / Camera
  "qrcode": "qr-code",
  "qrcode.viewfinder": "qr-code-scanner",
  "camera.fill": "camera-alt",

  // Martial Arts
  "figure.martial.arts": "sports-martial-arts",

  // Misc
  "magnifyingglass": "search",
  "ellipsis": "more-horiz",
  "ellipsis.circle": "more-vert",
  "star.fill": "star",
  "trophy.fill": "emoji-events",
  "rosette": "military-tech",
  "flag.fill": "flag",
  "location.fill": "location-on",
  "link": "link",
  "eye.fill": "visibility",
  "eye.slash.fill": "visibility-off",
} as IconMapping;

/**
 * An icon component that uses native SF Symbols on iOS, and Material Icons on Android and web.
 */
export function IconSymbol({
  name,
  size = 24,
  color,
  style,
}: {
  name: IconSymbolName;
  size?: number;
  color: string | OpaqueColorValue;
  style?: StyleProp<TextStyle>;
  weight?: SymbolWeight;
}) {
  return <MaterialIcons color={color} size={size} name={MAPPING[name]} style={style} />;
}
