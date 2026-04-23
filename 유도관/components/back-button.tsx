import { TouchableOpacity, Text, StyleSheet } from "react-native";
import { useRouter } from "expo-router";

interface BackButtonProps {
  onPress?: () => void;
  label?: string;
  color?: string;
}

/**
 * 뒤로가기 버튼 컴포넌트
 * - 최소 44×44pt 터치 영역 보장 (iOS HIG 기준)
 * - onPress 미지정 시 router.back() 자동 호출
 */
export function BackButton({ onPress, label = "‹", color = "#1565C0" }: BackButtonProps) {
  const router = useRouter();

  return (
    <TouchableOpacity
      onPress={onPress ?? (() => router.back())}
      style={styles.btn}
      hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}
      activeOpacity={0.6}
    >
      <Text style={[styles.icon, { color }]}>{label}</Text>
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  btn: {
    width: 44,
    height: 44,
    alignItems: "center",
    justifyContent: "center",
  },
  icon: {
    fontSize: 30,
    fontWeight: "300",
    lineHeight: 36,
  },
});
