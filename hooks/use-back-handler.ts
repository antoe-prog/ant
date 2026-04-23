import { useEffect, useRef } from "react";
import { BackHandler, Alert, Platform } from "react-native";

/**
 * 안드로이드 하드웨어 뒤로가기 버튼 처리 훅
 *
 * @param handler - 뒤로가기 버튼 눌렸을 때 실행할 함수.
 *                  true 반환 시 기본 동작(화면 이동) 차단, false 반환 시 기본 동작 허용
 * @param enabled - 핸들러 활성화 여부 (기본값: true)
 */
export function useBackHandler(
  handler: () => boolean,
  enabled: boolean = true,
) {
  const handlerRef = useRef(handler);
  handlerRef.current = handler;

  useEffect(() => {
    if (Platform.OS !== "android" || !enabled) return;
    const subscription = BackHandler.addEventListener("hardwareBackPress", () =>
      handlerRef.current(),
    );
    return () => subscription.remove();
  }, [enabled]);
}

/**
 * 탭 루트 화면용 뒤로가기 훅
 *
 * @param customHandler - 제공 시 실행(예: 관리 화면 서브탭 한 단계 뒤로). 이 경우 종료 확인은 띄우지 않음.
 *                        미제공 시 즉시 앱 종료 확인 다이얼로그 표시.
 */
export function useTabBackHandler(customHandler?: () => void) {
  useBackHandler(() => {
    if (customHandler) {
      customHandler();
      return true;
    }
    Alert.alert(
      "앱 종료",
      "앱을 종료하시겠습니까?",
      [
        { text: "취소", style: "cancel" },
        { text: "종료", style: "destructive", onPress: () => BackHandler.exitApp() },
      ],
      { cancelable: true },
    );
    return true;
  });
}

/**
 * 모달이 열린 상태에서 뒤로가기 시 모달 닫기 훅
 *
 * @param isVisible - 모달 열림 여부
 * @param onClose - 모달 닫기 함수
 */
export function useModalBackHandler(isVisible: boolean, onClose: () => void) {
  useBackHandler(() => {
    if (isVisible) {
      onClose();
      return true; // 모달 닫고 기본 동작 차단
    }
    return false; // 모달 닫혀있으면 기본 동작 허용
  }, isVisible);
}
