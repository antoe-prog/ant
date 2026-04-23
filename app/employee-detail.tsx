import React, { useState } from "react";
import {
  View,
  Text,
  ScrollView,
  TouchableOpacity,
  StyleSheet,
  Alert,
  ActivityIndicator,
  TextInput,
  Modal,
} from "react-native";
import { router, useLocalSearchParams } from "expo-router";
import { ScreenContainer } from "@/components/screen-container";
import { IconSymbol } from "@/components/ui/icon-symbol";
import { useColors } from "@/hooks/use-colors";
import { trpc } from "@/lib/trpc";
import {
  getStatusLabel,
  getStatusColor,
  getCategoryLabel,
  getPriorityLabel,
  getPriorityColor,
  formatDate,
  formatDateTime,
} from "@/lib/onboarding-utils";

// ─── Sub-components ───────────────────────────────────────────────────────────

function SectionHeader({ title, count }: { title: string; count?: number }) {
  const colors = useColors();
  return (
    <View style={styles.sectionHeader}>
      <Text style={[styles.sectionTitle, { color: colors.foreground }]}>{title}</Text>
      {count !== undefined && (
        <View style={[styles.countBadge, { backgroundColor: colors.primary + "20" }]}>
          <Text style={[styles.countText, { color: colors.primary }]}>{count}</Text>
        </View>
      )}
    </View>
  );
}

function StatusBadge({ status }: { status: string }) {
  const color = getStatusColor(status);
  return (
    <View style={[styles.badge, { backgroundColor: color + "20" }]}>
      <Text style={[styles.badgeText, { color }]}>{getStatusLabel(status)}</Text>
    </View>
  );
}

function TaskCard({
  task,
  onComplete,
  onDelete,
}: {
  task: any;
  onComplete: (id: number) => void;
  onDelete: (id: number) => void;
}) {
  const colors = useColors();
  const isCompleted = task.status === "completed";
  const priorityColor = getPriorityColor(task.priority ?? "medium");

  return (
    <View style={[styles.taskCard, { backgroundColor: colors.surface, borderColor: colors.border }]}>
      <View style={styles.taskHeader}>
        <View style={styles.taskTitleRow}>
          <View style={[styles.priorityDot, { backgroundColor: priorityColor }]} />
          <Text
            style={[
              styles.taskTitle,
              { color: isCompleted ? colors.muted : colors.foreground },
              isCompleted && styles.strikethrough,
            ]}
            numberOfLines={2}
          >
            {task.title}
          </Text>
        </View>
        <StatusBadge status={task.status} />
      </View>
      {task.description ? (
        <Text style={[styles.taskDesc, { color: colors.muted }]} numberOfLines={2}>
          {task.description}
        </Text>
      ) : null}
      <View style={styles.taskMeta}>
        <Text style={[styles.metaText, { color: colors.muted }]}>
          {getCategoryLabel(task.category ?? "other")} · {getPriorityLabel(task.priority ?? "medium")}
        </Text>
        {task.dueDate && (
          <Text style={[styles.metaText, { color: colors.muted }]}>
            마감: {formatDate(task.dueDate)}
          </Text>
        )}
      </View>
      {!isCompleted && (
        <View style={styles.taskActions}>
          <TouchableOpacity
            style={[styles.actionBtn, { backgroundColor: colors.primary + "15" }]}
            onPress={() => onComplete(task.id)}
          >
            <IconSymbol name="checkmark.circle.fill" size={14} color={colors.primary} />
            <Text style={[styles.actionBtnText, { color: colors.primary }]}>완료 처리</Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={[styles.actionBtn, { backgroundColor: "#EF444415" }]}
            onPress={() => onDelete(task.id)}
          >
            <IconSymbol name="trash.fill" size={14} color="#EF4444" />
            <Text style={[styles.actionBtnText, { color: "#EF4444" }]}>삭제</Text>
          </TouchableOpacity>
        </View>
      )}
    </View>
  );
}

function DocumentCard({ doc }: { doc: any }) {
  const colors = useColors();
  return (
    <View style={[styles.docCard, { backgroundColor: colors.surface, borderColor: colors.border }]}>
      <View style={[styles.docIcon, { backgroundColor: colors.primary + "15" }]}>
        <IconSymbol name="doc.fill" size={20} color={colors.primary} />
      </View>
      <View style={styles.docInfo}>
        <Text style={[styles.docName, { color: colors.foreground }]} numberOfLines={1}>
          {doc.name}
        </Text>
        <Text style={[styles.docMeta, { color: colors.muted }]}>
          {formatDateTime(doc.createdAt)}
        </Text>
      </View>
      <StatusBadge status={doc.status} />
    </View>
  );
}

function TrainingCard({ training }: { training: any }) {
  const colors = useColors();
  return (
    <View style={[styles.trainingCard, { backgroundColor: colors.surface, borderColor: colors.border }]}>
      <View style={styles.trainingHeader}>
        <View style={[styles.trainingIcon, { backgroundColor: "#8B5CF620" }]}>
          <IconSymbol name="graduationcap.fill" size={18} color="#8B5CF6" />
        </View>
        <View style={styles.trainingInfo}>
          <Text style={[styles.trainingTitle, { color: colors.foreground }]} numberOfLines={1}>
            {training.title}
          </Text>
          <Text style={[styles.trainingMeta, { color: colors.muted }]}>
            {formatDateTime(training.scheduledAt)}
            {training.instructor ? ` · ${training.instructor}` : ""}
          </Text>
        </View>
        <StatusBadge status={training.status} />
      </View>
    </View>
  );
}

// ─── Add Task Modal ───────────────────────────────────────────────────────────

function AddTaskModal({
  visible,
  planId,
  employeeId,
  onClose,
  onSuccess,
}: {
  visible: boolean;
  planId: number;
  employeeId: number;
  onClose: () => void;
  onSuccess: () => void;
}) {
  const colors = useColors();
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [category, setCategory] = useState<"document" | "training" | "setup" | "meeting" | "other">("other");
  const [priority, setPriority] = useState<"low" | "medium" | "high">("medium");

  const createTask = trpc.tasks.create.useMutation({
    onSuccess: () => {
      setTitle("");
      setDescription("");
      onSuccess();
      onClose();
    },
    onError: (err) => {
      Alert.alert("오류", err.message);
    },
  });

  const handleSubmit = () => {
    if (!title.trim()) {
      Alert.alert("입력 오류", "태스크 제목을 입력해주세요.");
      return;
    }
    createTask.mutate({
      planId,
      title: title.trim(),
      description: description.trim() || undefined,
      category,
      priority,
      assignedTo: employeeId,
    });
  };

  const categories: Array<{ value: typeof category; label: string }> = [
    { value: "document", label: "서류" },
    { value: "training", label: "교육" },
    { value: "setup", label: "환경설정" },
    { value: "meeting", label: "미팅" },
    { value: "other", label: "기타" },
  ];

  const priorities: Array<{ value: typeof priority; label: string; color: string }> = [
    { value: "low", label: "낮음", color: "#10B981" },
    { value: "medium", label: "보통", color: "#F59E0B" },
    { value: "high", label: "높음", color: "#EF4444" },
  ];

  return (
    <Modal visible={visible} animationType="slide" presentationStyle="pageSheet" onRequestClose={onClose}>
      <View style={[styles.modalContainer, { backgroundColor: colors.background }]}>
        {/* Header */}
        <View style={[styles.modalHeader, { borderBottomColor: colors.border }]}>
          <TouchableOpacity onPress={onClose}>
            <Text style={[styles.modalCancel, { color: colors.muted }]}>취소</Text>
          </TouchableOpacity>
          <Text style={[styles.modalTitle, { color: colors.foreground }]}>태스크 추가</Text>
          <TouchableOpacity onPress={handleSubmit} disabled={createTask.isPending}>
            {createTask.isPending ? (
              <ActivityIndicator size="small" color={colors.primary} />
            ) : (
              <Text style={[styles.modalSave, { color: colors.primary }]}>저장</Text>
            )}
          </TouchableOpacity>
        </View>

        <ScrollView style={styles.modalBody} contentContainerStyle={{ gap: 20, padding: 20 }}>
          {/* Title */}
          <View style={styles.formField}>
            <Text style={[styles.fieldLabel, { color: colors.foreground }]}>제목 *</Text>
            <TextInput
              style={[styles.textInput, { backgroundColor: colors.surface, borderColor: colors.border, color: colors.foreground }]}
              value={title}
              onChangeText={setTitle}
              placeholder="태스크 제목 입력"
              placeholderTextColor={colors.muted}
              returnKeyType="next"
            />
          </View>

          {/* Description */}
          <View style={styles.formField}>
            <Text style={[styles.fieldLabel, { color: colors.foreground }]}>설명</Text>
            <TextInput
              style={[styles.textInput, styles.textArea, { backgroundColor: colors.surface, borderColor: colors.border, color: colors.foreground }]}
              value={description}
              onChangeText={setDescription}
              placeholder="태스크 설명 (선택사항)"
              placeholderTextColor={colors.muted}
              multiline
              numberOfLines={3}
              returnKeyType="done"
            />
          </View>

          {/* Category */}
          <View style={styles.formField}>
            <Text style={[styles.fieldLabel, { color: colors.foreground }]}>카테고리</Text>
            <View style={styles.chipRow}>
              {categories.map((c) => (
                <TouchableOpacity
                  key={c.value}
                  style={[
                    styles.chip,
                    {
                      backgroundColor: category === c.value ? colors.primary : colors.surface,
                      borderColor: category === c.value ? colors.primary : colors.border,
                    },
                  ]}
                  onPress={() => setCategory(c.value)}
                >
                  <Text style={[styles.chipText, { color: category === c.value ? "#fff" : colors.muted }]}>
                    {c.label}
                  </Text>
                </TouchableOpacity>
              ))}
            </View>
          </View>

          {/* Priority */}
          <View style={styles.formField}>
            <Text style={[styles.fieldLabel, { color: colors.foreground }]}>우선순위</Text>
            <View style={styles.chipRow}>
              {priorities.map((p) => (
                <TouchableOpacity
                  key={p.value}
                  style={[
                    styles.chip,
                    {
                      backgroundColor: priority === p.value ? p.color : colors.surface,
                      borderColor: priority === p.value ? p.color : colors.border,
                    },
                  ]}
                  onPress={() => setPriority(p.value)}
                >
                  <Text style={[styles.chipText, { color: priority === p.value ? "#fff" : colors.muted }]}>
                    {p.label}
                  </Text>
                </TouchableOpacity>
              ))}
            </View>
          </View>
        </ScrollView>
      </View>
    </Modal>
  );
}

// ─── Main Screen ──────────────────────────────────────────────────────────────

export default function EmployeeDetailScreen() {
  const colors = useColors();
  const { employeeId } = useLocalSearchParams<{ employeeId: string }>();
  const empId = parseInt(employeeId ?? "0", 10);

  const [showAddTask, setShowAddTask] = useState(false);
  const [activeTab, setActiveTab] = useState<"tasks" | "documents" | "trainings">("tasks");

  const { data, isLoading, refetch } = trpc.hr.employeeWithPlan.useQuery(
    { employeeId: empId },
    { enabled: empId > 0 }
  );

  const completeTask = trpc.tasks.update.useMutation({
    onSuccess: () => refetch(),
    onError: (err) => Alert.alert("오류", err.message),
  });

  const deleteTask = trpc.tasks.delete.useMutation({
    onSuccess: () => refetch(),
    onError: (err) => Alert.alert("오류", err.message),
  });

  const handleCompleteTask = (taskId: number) => {
    Alert.alert("태스크 완료", "이 태스크를 완료 처리하시겠습니까?", [
      { text: "취소", style: "cancel" },
      {
        text: "완료",
        onPress: () => completeTask.mutate({ id: taskId, status: "completed" }),
      },
    ]);
  };

  const handleDeleteTask = (taskId: number) => {
    Alert.alert("태스크 삭제", "이 태스크를 삭제하시겠습니까?", [
      { text: "취소", style: "cancel" },
      {
        text: "삭제",
        style: "destructive",
        onPress: () => deleteTask.mutate({ id: taskId }),
      },
    ]);
  };

  if (isLoading) {
    return (
      <ScreenContainer>
        <View style={styles.centered}>
          <ActivityIndicator size="large" color={colors.primary} />
          <Text style={[styles.loadingText, { color: colors.muted }]}>불러오는 중...</Text>
        </View>
      </ScreenContainer>
    );
  }

  if (!data || !data.employee) {
    return (
      <ScreenContainer>
        <View style={styles.centered}>
          <IconSymbol name="exclamationmark.triangle.fill" size={48} color={colors.muted} />
          <Text style={[styles.errorTitle, { color: colors.foreground }]}>직원을 찾을 수 없습니다</Text>
          <TouchableOpacity
            style={[styles.backBtn, { backgroundColor: colors.primary }]}
            onPress={() => router.back()}
          >
            <Text style={styles.backBtnText}>돌아가기</Text>
          </TouchableOpacity>
        </View>
      </ScreenContainer>
    );
  }

  const { employee, plan, tasks: taskList, documents: docList, trainings: trainingList } = data;

  const tabs = [
    { key: "tasks" as const, label: "태스크", count: taskList.length },
    { key: "documents" as const, label: "서류", count: docList.length },
    { key: "trainings" as const, label: "교육", count: trainingList.length },
  ];

  return (
    <ScreenContainer>
      {/* Header */}
      <View style={[styles.header, { borderBottomColor: colors.border }]}>
        <TouchableOpacity style={styles.backButton} onPress={() => router.back()}>
          <IconSymbol name="chevron.left" size={24} color={colors.primary} />
        </TouchableOpacity>
        <Text style={[styles.headerTitle, { color: colors.foreground }]} numberOfLines={1}>
          직원 상세
        </Text>
        {plan && (
          <TouchableOpacity
            style={[styles.addTaskBtn, { backgroundColor: colors.primary }]}
            onPress={() => setShowAddTask(true)}
          >
            <IconSymbol name="plus" size={16} color="#fff" />
          </TouchableOpacity>
        )}
      </View>

      <ScrollView showsVerticalScrollIndicator={false}>
        {/* Employee Profile Card */}
        <View style={[styles.profileCard, { backgroundColor: colors.surface, borderColor: colors.border }]}>
          <View style={[styles.profileAvatar, { backgroundColor: colors.primary + "20" }]}>
            <Text style={[styles.profileAvatarText, { color: colors.primary }]}>
              {(employee.name ?? "?").slice(0, 2)}
            </Text>
          </View>
          <View style={styles.profileInfo}>
            <Text style={[styles.profileName, { color: colors.foreground }]}>
              {employee.name ?? "이름 없음"}
            </Text>
            <Text style={[styles.profileEmail, { color: colors.muted }]}>
              {employee.email ?? "이메일 없음"}
            </Text>
            {(employee.department || employee.position) && (
              <Text style={[styles.profileDept, { color: colors.muted }]}>
                {[employee.department, employee.position].filter(Boolean).join(" · ")}
              </Text>
            )}
          </View>
        </View>

        {/* Plan Summary */}
        {plan ? (
          <View style={[styles.planCard, { backgroundColor: colors.surface, borderColor: colors.border }]}>
            <View style={styles.planHeader}>
              <Text style={[styles.planTitle, { color: colors.foreground }]}>온보딩 계획</Text>
              <StatusBadge status={plan.status} />
            </View>
            <View style={styles.progressSection}>
              <View style={styles.progressLabelRow}>
                <Text style={[styles.progressLabel, { color: colors.muted }]}>진행률</Text>
                <Text style={[styles.progressValue, { color: colors.primary }]}>
                  {plan.completionRate ?? 0}%
                </Text>
              </View>
              <View style={[styles.progressBar, { backgroundColor: colors.border }]}>
                <View
                  style={[
                    styles.progressFill,
                    {
                      backgroundColor: colors.primary,
                      width: `${plan.completionRate ?? 0}%` as any,
                    },
                  ]}
                />
              </View>
            </View>
            {plan.targetCompletionDate && (
              <Text style={[styles.planDue, { color: colors.muted }]}>
                목표 완료일: {formatDate(plan.targetCompletionDate)}
              </Text>
            )}
          </View>
        ) : (
          <View style={[styles.noPlanCard, { backgroundColor: colors.surface, borderColor: colors.border }]}>
            <IconSymbol name="doc.badge.plus" size={32} color={colors.muted} />
            <Text style={[styles.noPlanText, { color: colors.muted }]}>
              아직 온보딩 계획이 없습니다
            </Text>
          </View>
        )}

        {/* Tabs */}
        {plan && (
          <>
            <View style={[styles.tabBar, { borderBottomColor: colors.border }]}>
              {tabs.map((tab) => (
                <TouchableOpacity
                  key={tab.key}
                  style={[
                    styles.tab,
                    activeTab === tab.key && { borderBottomColor: colors.primary, borderBottomWidth: 2 },
                  ]}
                  onPress={() => setActiveTab(tab.key)}
                >
                  <Text
                    style={[
                      styles.tabLabel,
                      { color: activeTab === tab.key ? colors.primary : colors.muted },
                    ]}
                  >
                    {tab.label}
                  </Text>
                  <View style={[styles.tabCount, { backgroundColor: activeTab === tab.key ? colors.primary + "20" : colors.border }]}>
                    <Text style={[styles.tabCountText, { color: activeTab === tab.key ? colors.primary : colors.muted }]}>
                      {tab.count}
                    </Text>
                  </View>
                </TouchableOpacity>
              ))}
            </View>

            {/* Tab Content */}
            <View style={styles.tabContent}>
              {activeTab === "tasks" && (
                <>
                  <SectionHeader title="태스크 목록" count={taskList.length} />
                  {taskList.length === 0 ? (
                    <View style={styles.emptySection}>
                      <IconSymbol name="checklist" size={36} color={colors.muted} />
                      <Text style={[styles.emptyText, { color: colors.muted }]}>
                        태스크가 없습니다
                      </Text>
                      <TouchableOpacity
                        style={[styles.addFirstBtn, { borderColor: colors.primary }]}
                        onPress={() => setShowAddTask(true)}
                      >
                        <Text style={[styles.addFirstBtnText, { color: colors.primary }]}>
                          + 첫 태스크 추가
                        </Text>
                      </TouchableOpacity>
                    </View>
                  ) : (
                    <View style={styles.cardList}>
                      {taskList.map((task) => (
                        <TaskCard
                          key={task.id}
                          task={task}
                          onComplete={handleCompleteTask}
                          onDelete={handleDeleteTask}
                        />
                      ))}
                    </View>
                  )}
                </>
              )}

              {activeTab === "documents" && (
                <>
                  <SectionHeader title="제출 서류" count={docList.length} />
                  {docList.length === 0 ? (
                    <View style={styles.emptySection}>
                      <IconSymbol name="doc.fill" size={36} color={colors.muted} />
                      <Text style={[styles.emptyText, { color: colors.muted }]}>
                        제출된 서류가 없습니다
                      </Text>
                    </View>
                  ) : (
                    <View style={styles.cardList}>
                      {docList.map((doc) => (
                        <DocumentCard key={doc.id} doc={doc} />
                      ))}
                    </View>
                  )}
                </>
              )}

              {activeTab === "trainings" && (
                <>
                  <SectionHeader title="교육 일정" count={trainingList.length} />
                  {trainingList.length === 0 ? (
                    <View style={styles.emptySection}>
                      <IconSymbol name="graduationcap.fill" size={36} color={colors.muted} />
                      <Text style={[styles.emptyText, { color: colors.muted }]}>
                        교육 일정이 없습니다
                      </Text>
                    </View>
                  ) : (
                    <View style={styles.cardList}>
                      {trainingList.map((training) => (
                        <TrainingCard key={training.id} training={training} />
                      ))}
                    </View>
                  )}
                </>
              )}
            </View>
          </>
        )}

        <View style={{ height: 40 }} />
      </ScrollView>

      {/* Add Task Modal */}
      {plan && (
        <AddTaskModal
          visible={showAddTask}
          planId={plan.id}
          employeeId={empId}
          onClose={() => setShowAddTask(false)}
          onSuccess={() => refetch()}
        />
      )}
    </ScreenContainer>
  );
}

const styles = StyleSheet.create({
  centered: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    gap: 16,
    padding: 32,
  },
  loadingText: {
    fontSize: 14,
  },
  errorTitle: {
    fontSize: 16,
    fontWeight: "600",
  },
  backBtn: {
    paddingHorizontal: 24,
    paddingVertical: 12,
    borderRadius: 12,
    marginTop: 8,
  },
  backBtnText: {
    color: "#fff",
    fontWeight: "600",
    fontSize: 15,
  },
  header: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 16,
    paddingVertical: 14,
    borderBottomWidth: 1,
    gap: 12,
  },
  backButton: {
    padding: 4,
  },
  headerTitle: {
    flex: 1,
    fontSize: 18,
    fontWeight: "700",
  },
  addTaskBtn: {
    width: 32,
    height: 32,
    borderRadius: 16,
    alignItems: "center",
    justifyContent: "center",
  },
  profileCard: {
    flexDirection: "row",
    alignItems: "center",
    gap: 14,
    margin: 16,
    padding: 16,
    borderRadius: 16,
    borderWidth: 1,
  },
  profileAvatar: {
    width: 56,
    height: 56,
    borderRadius: 28,
    alignItems: "center",
    justifyContent: "center",
    flexShrink: 0,
  },
  profileAvatarText: {
    fontSize: 22,
    fontWeight: "700",
  },
  profileInfo: {
    flex: 1,
    gap: 3,
  },
  profileName: {
    fontSize: 18,
    fontWeight: "700",
  },
  profileEmail: {
    fontSize: 13,
  },
  profileDept: {
    fontSize: 12,
  },
  planCard: {
    marginHorizontal: 16,
    marginBottom: 12,
    padding: 16,
    borderRadius: 16,
    borderWidth: 1,
    gap: 12,
  },
  planHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  planTitle: {
    fontSize: 15,
    fontWeight: "600",
  },
  progressSection: {
    gap: 6,
  },
  progressLabelRow: {
    flexDirection: "row",
    justifyContent: "space-between",
  },
  progressLabel: {
    fontSize: 13,
  },
  progressValue: {
    fontSize: 13,
    fontWeight: "700",
  },
  progressBar: {
    height: 6,
    borderRadius: 3,
    overflow: "hidden",
  },
  progressFill: {
    height: "100%",
    borderRadius: 3,
  },
  planDue: {
    fontSize: 12,
  },
  noPlanCard: {
    marginHorizontal: 16,
    marginBottom: 12,
    padding: 24,
    borderRadius: 16,
    borderWidth: 1,
    alignItems: "center",
    gap: 8,
  },
  noPlanText: {
    fontSize: 14,
  },
  tabBar: {
    flexDirection: "row",
    borderBottomWidth: 1,
    marginHorizontal: 16,
  },
  tab: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    paddingVertical: 12,
    gap: 6,
    borderBottomWidth: 2,
    borderBottomColor: "transparent",
  },
  tabLabel: {
    fontSize: 13,
    fontWeight: "600",
  },
  tabCount: {
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 8,
    minWidth: 20,
    alignItems: "center",
  },
  tabCountText: {
    fontSize: 11,
    fontWeight: "700",
  },
  tabContent: {
    paddingHorizontal: 16,
    paddingTop: 12,
  },
  sectionHeader: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    marginBottom: 10,
  },
  sectionTitle: {
    fontSize: 15,
    fontWeight: "700",
  },
  countBadge: {
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 10,
  },
  countText: {
    fontSize: 12,
    fontWeight: "700",
  },
  cardList: {
    gap: 10,
    marginBottom: 16,
  },
  emptySection: {
    alignItems: "center",
    gap: 10,
    paddingVertical: 32,
  },
  emptyText: {
    fontSize: 14,
  },
  addFirstBtn: {
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderRadius: 10,
    borderWidth: 1,
    marginTop: 4,
  },
  addFirstBtnText: {
    fontSize: 14,
    fontWeight: "600",
  },
  // Task Card
  taskCard: {
    padding: 14,
    borderRadius: 14,
    borderWidth: 1,
    gap: 8,
  },
  taskHeader: {
    flexDirection: "row",
    alignItems: "flex-start",
    justifyContent: "space-between",
    gap: 8,
  },
  taskTitleRow: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },
  priorityDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    flexShrink: 0,
  },
  taskTitle: {
    flex: 1,
    fontSize: 14,
    fontWeight: "600",
    lineHeight: 20,
  },
  strikethrough: {
    textDecorationLine: "line-through",
    opacity: 0.6,
  },
  taskDesc: {
    fontSize: 12,
    lineHeight: 18,
    paddingLeft: 16,
  },
  taskMeta: {
    flexDirection: "row",
    justifyContent: "space-between",
    paddingLeft: 16,
  },
  metaText: {
    fontSize: 11,
  },
  taskActions: {
    flexDirection: "row",
    gap: 8,
    paddingLeft: 16,
  },
  actionBtn: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 8,
  },
  actionBtnText: {
    fontSize: 12,
    fontWeight: "600",
  },
  // Document Card
  docCard: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    padding: 12,
    borderRadius: 12,
    borderWidth: 1,
  },
  docIcon: {
    width: 40,
    height: 40,
    borderRadius: 10,
    alignItems: "center",
    justifyContent: "center",
    flexShrink: 0,
  },
  docInfo: {
    flex: 1,
    gap: 3,
  },
  docName: {
    fontSize: 14,
    fontWeight: "600",
  },
  docMeta: {
    fontSize: 11,
  },
  // Training Card
  trainingCard: {
    padding: 12,
    borderRadius: 12,
    borderWidth: 1,
  },
  trainingHeader: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
  },
  trainingIcon: {
    width: 36,
    height: 36,
    borderRadius: 10,
    alignItems: "center",
    justifyContent: "center",
    flexShrink: 0,
  },
  trainingInfo: {
    flex: 1,
    gap: 3,
  },
  trainingTitle: {
    fontSize: 14,
    fontWeight: "600",
  },
  trainingMeta: {
    fontSize: 11,
  },
  // Badge
  badge: {
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 8,
    flexShrink: 0,
  },
  badgeText: {
    fontSize: 11,
    fontWeight: "600",
  },
  // Modal
  modalContainer: {
    flex: 1,
  },
  modalHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 20,
    paddingVertical: 16,
    borderBottomWidth: 1,
  },
  modalTitle: {
    fontSize: 17,
    fontWeight: "700",
  },
  modalCancel: {
    fontSize: 16,
  },
  modalSave: {
    fontSize: 16,
    fontWeight: "700",
  },
  modalBody: {
    flex: 1,
  },
  formField: {
    gap: 8,
  },
  fieldLabel: {
    fontSize: 14,
    fontWeight: "600",
  },
  textInput: {
    paddingHorizontal: 14,
    paddingVertical: 12,
    borderRadius: 12,
    borderWidth: 1,
    fontSize: 15,
  },
  textArea: {
    minHeight: 80,
    textAlignVertical: "top",
  },
  chipRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 8,
  },
  chip: {
    paddingHorizontal: 14,
    paddingVertical: 7,
    borderRadius: 20,
    borderWidth: 1,
  },
  chipText: {
    fontSize: 13,
    fontWeight: "600",
  },
});
