import type { Metadata } from "next";
import Link from "next/link";
import { LegalPageShell, LegalSection } from "@/components/legal/legal-page-shell";

export const metadata: Metadata = {
  title: "개인정보처리방침",
  description: "파이널 유도 멀티짐 서비스의 개인정보 처리 기준을 안내합니다.",
};

const effectiveDate = "2026년 7월 22일";
const processedDataRows = [
  {
    category: "계정",
    items: "이름, 휴대전화번호, 비밀번호 해시, 이메일(입력 시), 역할, 이용 지점",
    purpose: "가입, 인증, 계정과 권한 관리",
  },
  {
    category: "회원 관리",
    items: "성별, 생년월일, 주소, 연령 구분, 띠·레벨, 보호자 관계, 비상 연락처, 회원 상태와 이용기간",
    purpose: "회원 등록, 수업 배정, 보호자 연결, 안전한 시설 운영",
  },
  {
    category: "수업·수련",
    items: "수업 신청, 출결 상태와 일시, 출석 메모, 승급 심사 결과·점수·메모, 상담 기록",
    purpose: "수업 운영, 출석 확인, 수련·승급·상담 관리",
  },
  {
    category: "결제",
    items: "결제자 이름·연락처, 결제수단 종류, 금액, 결제·환불 상태, 거래 식별값과 영수증 정보",
    purpose: "회비 청구, 결제 확인, 환불과 거래 기록 관리",
  },
  {
    category: "공지·기기",
    items: "공지 읽음 상태, 푸시 구독 주소와 암호화 키, 기기·브라우저 정보",
    purpose: "공지 알림 전송, 구독 상태 관리",
  },
  {
    category: "보안·운영",
    items: "세션 식별값의 해시, 로그인·변경 기록, 처리 일시",
    purpose: "접근 통제, 장애 대응, 부정 이용 방지와 변경 이력 확인",
  },
];
const retentionRows = [
  { record: "계약·청약철회 기록", period: "5년", basis: "전자상거래법" },
  { record: "대금결제·서비스 공급 기록", period: "5년", basis: "전자상거래법" },
  { record: "소비자 불만·분쟁 처리 기록", period: "3년", basis: "전자상거래법" },
];
const processorRows = [
  {
    company: "카페24",
    task: "서비스 운영 인프라 지원과 데이터 보관·관리",
    period: "위탁계약 종료 또는 처리 목적 달성 시까지",
  },
  {
    company: "Vercel Inc.",
    task: "웹·앱 호스팅, 배포 및 서버 실행",
    period: "위탁계약 종료 또는 처리 목적 달성 시까지",
  },
  {
    company: "Neon, Inc.",
    task: "PostgreSQL 데이터베이스 호스팅과 백업",
    period: "위탁계약 종료 또는 처리 목적 달성 시까지",
  },
];

export default function PrivacyPage() {
  return (
    <LegalPageShell
      title="개인정보처리방침"
      description="파이널 유도 멀티짐은 회원과 보호자의 개인정보를 필요한 범위에서 처리하고 안전하게 보호합니다."
    >
      <div className="rounded-md border border-teal-200 bg-teal-50 px-4 py-4 text-sm leading-6 text-teal-950">
        <p className="font-semibold">시행일 {effectiveDate}</p>
        <p className="mt-1">본 방침은 파이널 유도 멀티짐 웹·Android 앱에 적용됩니다.</p>
      </div>

      <LegalSection title="1. 개인정보 처리 목적">
        <p>다음 목적에 필요한 범위에서 개인정보를 처리하며, 다른 목적으로 이용할 때에는 별도 동의를 받습니다.</p>
        <ul className="list-disc space-y-2 pl-5">
          <li>회원가입, 본인 확인, 로그인, 계정과 지점 관리</li>
          <li>회원 등록, 보호자 연결, 수업 신청, 출결 및 QR 출석 관리</li>
          <li>수련 과정, 띠·승급 심사, 상담과 안전 주의사항 관리</li>
          <li>회비 결제, 환불, 영수증, 미납 및 이용기간 관리</li>
          <li>공지·알림 전달, 문의·분쟁 처리, 서비스 보안과 부정 이용 방지</li>
        </ul>
      </LegalSection>

      <LegalSection title="2. 처리하는 개인정보 항목">
        <dl className="divide-y divide-zinc-200 rounded-md border border-zinc-200 bg-white md:hidden">
          {processedDataRows.map((row) => (
            <div className="px-4 py-4" key={row.category}>
              <dt className="font-semibold text-zinc-950">{row.category}</dt>
              <dd className="mt-2"><span className="font-semibold text-zinc-700">항목</span> · {row.items}</dd>
              <dd className="mt-1"><span className="font-semibold text-zinc-700">목적</span> · {row.purpose}</dd>
            </div>
          ))}
        </dl>
        <div className="hidden overflow-x-auto rounded-md border border-zinc-200 md:block">
          <table className="min-w-[720px] w-full border-collapse text-left text-sm">
            <thead className="bg-zinc-100 text-zinc-700">
              <tr>
                <th className="px-4 py-3 font-semibold">구분</th>
                <th className="px-4 py-3 font-semibold">처리 항목</th>
                <th className="px-4 py-3 font-semibold">처리 목적</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-zinc-200 bg-white align-top">
              {processedDataRows.map((row) => (
                <tr key={row.category}>
                  <td className="px-4 py-3 font-semibold text-zinc-900">{row.category}</td>
                  <td className="px-4 py-3">{row.items}</td>
                  <td className="px-4 py-3">{row.purpose}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p>QR 출석 스캔 시 카메라에 접근하지만 촬영 화면, 사진 또는 영상은 저장하거나 서버로 전송하지 않습니다.</p>
        <p>카드번호, 카드 비밀번호, 주민등록번호는 서비스가 직접 수집하거나 저장하지 않습니다.</p>
      </LegalSection>

      <LegalSection title="3. 민감정보 처리">
        <p>
          부상, 질환, 알레르기 등 건강 관련 주의사항은 회원의 안전한 수련을 위해 필요한 경우에만 별도 동의를 받아 처리합니다.
          동의를 거부할 수 있으나, 안전상 필요한 수업 배정이나 보호 조치가 제한될 수 있습니다.
        </p>
        <p>상세 진단서나 불필요한 의료정보는 등록하지 않으며, 접근 가능한 역할과 지점을 제한합니다.</p>
      </LegalSection>

      <LegalSection title="4. 만 14세 미만 아동의 개인정보">
        <p>
          만 14세 미만 아동의 개인정보에 동의가 필요한 경우 법정대리인의 동의를 받고 동의 여부를 확인합니다. 보호자는 연결된
          자녀의 수업·출결·성장·결제·공지 정보를 서비스에서 확인할 수 있습니다.
        </p>
      </LegalSection>

      <LegalSection title="5. 개인정보 보유 및 이용기간">
        <p>
          서비스 운영에 필요한 개인정보는 이용기간 동안 처리하고, 서비스 이용 종료 또는 회원 탈퇴 후 2년간 분쟁 대응과 운영 기록
          확인을 위해 보관한 뒤 파기합니다. 계정 및 데이터 삭제 요청이 접수되면 법령상 보관 의무가 있는 정보를 제외하고 지체 없이
          삭제합니다.
        </p>
        <dl className="divide-y divide-zinc-200 rounded-md border border-zinc-200 bg-white md:hidden">
          {retentionRows.map((row) => (
            <div className="flex items-start justify-between gap-4 px-4 py-4" key={row.record}>
              <dt className="font-semibold text-zinc-950">
                {row.record}
                <span className="mt-1 block font-normal text-zinc-600">{row.basis}</span>
              </dt>
              <dd className="shrink-0 font-semibold text-teal-800">{row.period}</dd>
            </div>
          ))}
        </dl>
        <div className="hidden overflow-x-auto rounded-md border border-zinc-200 md:block">
          <table className="min-w-[620px] w-full border-collapse text-left text-sm">
            <thead className="bg-zinc-100 text-zinc-700">
              <tr>
                <th className="px-4 py-3 font-semibold">기록</th>
                <th className="px-4 py-3 font-semibold">보유기간</th>
                <th className="px-4 py-3 font-semibold">근거</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-zinc-200 bg-white">
              {retentionRows.map((row) => (
                <tr key={row.record}>
                  <td className="px-4 py-3">{row.record}</td>
                  <td className="px-4 py-3">{row.period}</td>
                  <td className="px-4 py-3">{row.basis}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p>법령에 따라 별도 보관하는 정보는 다른 정보와 분리하여 해당 목적에만 이용합니다.</p>
      </LegalSection>

      <LegalSection title="6. 개인정보의 제3자 제공">
        <p>
          개인정보를 원칙적으로 외부에 제공하지 않습니다. 정보주체가 사전에 동의하거나 법령에 특별한 규정이 있는 경우에만 필요한
          범위에서 제공합니다.
        </p>
      </LegalSection>

      <LegalSection title="7. 개인정보 처리 위탁">
        <p>안정적인 서비스 제공을 위해 다음 업체에 개인정보 처리업무의 일부를 위탁합니다.</p>
        <dl className="divide-y divide-zinc-200 rounded-md border border-zinc-200 bg-white md:hidden">
          {processorRows.map((row) => (
            <div className="px-4 py-4" key={row.company}>
              <dt className="font-semibold text-zinc-950">{row.company}</dt>
              <dd className="mt-2">{row.task}</dd>
              <dd className="mt-1 text-zinc-600">{row.period}</dd>
            </div>
          ))}
        </dl>
        <div className="hidden overflow-x-auto rounded-md border border-zinc-200 md:block">
          <table className="min-w-[620px] w-full border-collapse text-left text-sm">
            <thead className="bg-zinc-100 text-zinc-700">
              <tr>
                <th className="px-4 py-3 font-semibold">수탁업체</th>
                <th className="px-4 py-3 font-semibold">위탁업무</th>
                <th className="px-4 py-3 font-semibold">보유·이용기간</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-zinc-200 bg-white align-top">
              {processorRows.map((row) => (
                <tr key={row.company}>
                  <td className="px-4 py-3 font-semibold text-zinc-900">{row.company}</td>
                  <td className="px-4 py-3">{row.task}</td>
                  <td className="px-4 py-3">{row.period}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p>수탁업체가 개인정보 보호 관련 의무를 준수하도록 필요한 사항을 관리·감독합니다.</p>
      </LegalSection>

      <LegalSection title="8. 개인정보 파기">
        <p>
          보유기간이 끝나거나 처리 목적이 달성된 개인정보는 지체 없이 파기합니다. 전자 파일은 복구할 수 없는 방법으로 삭제하고,
          종이 문서는 분쇄 또는 소각합니다.
        </p>
      </LegalSection>

      <LegalSection title="9. 정보주체와 법정대리인의 권리">
        <p>본인 또는 법정대리인은 개인정보 열람·정정·삭제·처리정지와 동의 철회를 요청할 수 있습니다.</p>
        <ul className="list-disc space-y-2 pl-5">
          <li>앱 내 경로: 내 계정 → 개인정보·계정 관리 → 계정 및 데이터 삭제</li>
          <li>웹 경로: <Link className="font-semibold text-teal-700 underline underline-offset-4" href="/account-deletion">계정 및 데이터 삭제 안내</Link></li>
          <li>이메일: <a className="font-semibold text-teal-700 underline underline-offset-4" href="mailto:chosk88@naver.com">chosk88@naver.com</a></li>
          <li>전화: <a className="font-semibold text-teal-700 underline underline-offset-4" href="tel:01092970524">010-9297-0524</a></li>
        </ul>
        <p>권리 요청 시 등록된 연락처 등을 이용해 본인 또는 정당한 법정대리인인지 확인할 수 있습니다.</p>
      </LegalSection>

      <LegalSection title="10. 안전성 확보 조치">
        <ul className="list-disc space-y-2 pl-5">
          <li>비밀번호와 인증 토큰의 원문 비저장 및 암호화된 통신 사용</li>
          <li>역할·지점별 접근권한 통제와 중요 변경 기록 관리</li>
          <li>민감정보 노출 최소화, 저장소 무결성 점검과 장애 대응</li>
          <li>처리 위탁업체에 대한 개인정보 보호 의무 확인</li>
        </ul>
      </LegalSection>

      <LegalSection title="11. 개인정보 보호책임자">
        <dl className="grid gap-3 rounded-md border border-zinc-200 bg-white p-4 sm:grid-cols-[10rem_1fr]">
          <dt className="font-semibold text-zinc-900">운영자·보호책임자</dt>
          <dd>조승권</dd>
          <dt className="font-semibold text-zinc-900">전화</dt>
          <dd><a className="text-teal-700 underline underline-offset-4" href="tel:01092970524">010-9297-0524</a></dd>
          <dt className="font-semibold text-zinc-900">이메일</dt>
          <dd><a className="text-teal-700 underline underline-offset-4" href="mailto:chosk88@naver.com">chosk88@naver.com</a></dd>
          <dt className="font-semibold text-zinc-900">주소</dt>
          <dd>서울특별시 강서구 등촌로 17</dd>
        </dl>
      </LegalSection>

      <LegalSection title="12. 방침 변경">
        <p>내용이 변경되면 시행 전에 서비스 공지 또는 화면을 통해 알립니다.</p>
        <p>공고일·시행일: {effectiveDate}</p>
      </LegalSection>
    </LegalPageShell>
  );
}
