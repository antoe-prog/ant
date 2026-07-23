import type { Metadata } from "next";
import Link from "next/link";
import { Mail, Phone, Trash2 } from "lucide-react";
import { LegalPageShell, LegalSection } from "@/components/legal/legal-page-shell";

export const metadata: Metadata = {
  title: "계정 및 데이터 삭제",
  description: "파이널 유도 멀티짐 계정과 관련 데이터의 삭제 요청 방법을 안내합니다.",
};

const deletionRequestHref = `mailto:chosk88@naver.com?subject=${encodeURIComponent(
  "[파이널 유도 멀티짐] 계정 및 데이터 삭제 요청",
)}&body=${encodeURIComponent("가입자 이름:\n가입 휴대전화번호:\n이용 지점:\n요청 내용: 계정 및 관련 데이터 삭제를 요청합니다.")}`;

export default function AccountDeletionPage() {
  return (
    <LegalPageShell
      title="계정 및 데이터 삭제"
      description="파이널 유도 멀티짐 계정을 더 이상 사용하지 않는 경우 앱을 다시 설치하지 않아도 삭제를 요청할 수 있습니다."
    >
      <div className="rounded-md border border-red-200 bg-red-50 px-4 py-4 text-sm leading-6 text-red-950">
        <div className="flex items-start gap-3">
          <Trash2 className="mt-0.5 h-5 w-5 shrink-0" aria-hidden />
          <div>
            <p className="font-semibold">계정 비활성화가 아닌 영구 삭제 요청입니다.</p>
            <p className="mt-1">처리가 완료되면 기존 계정으로 로그인할 수 없고 삭제된 정보는 복구할 수 없습니다.</p>
          </div>
        </div>
      </div>

      <LegalSection title="1. 삭제 요청 방법">
        <p>아래 이메일 버튼을 누르고 가입자 이름, 가입 휴대전화번호, 이용 지점만 작성해 보내 주세요.</p>
        <a
          className="inline-flex min-h-11 items-center justify-center gap-2 rounded-md bg-zinc-950 px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-zinc-800"
          data-testid="account-deletion-email-link"
          href={deletionRequestHref}
        >
          <Mail className="h-4 w-4" aria-hidden />
          삭제 요청 이메일 작성
        </a>
        <p>이메일 사용이 어려우면 운영자에게 전화로 삭제 절차를 요청할 수 있습니다.</p>
        <a
          className="inline-flex min-h-11 items-center justify-center gap-2 rounded-md border border-zinc-300 bg-white px-4 py-2.5 text-sm font-semibold text-zinc-800 transition hover:bg-zinc-100"
          href="tel:01092970524"
        >
          <Phone className="h-4 w-4" aria-hidden />
          010-9297-0524
        </a>
      </LegalSection>

      <LegalSection title="2. 요청 시 주의사항">
        <ul className="list-disc space-y-2 pl-5">
          <li>비밀번호, 주민등록번호, 카드번호, 건강정보는 이메일에 작성하지 마세요.</li>
          <li>등록된 휴대전화번호 등을 이용해 본인 또는 법정대리인 여부를 확인할 수 있습니다.</li>
          <li>미성년 회원은 연결된 법정대리인이 삭제를 요청할 수 있습니다.</li>
          <li>정기결제 또는 처리 중인 환불이 있다면 해당 절차를 먼저 안내할 수 있습니다.</li>
        </ul>
      </LegalSection>

      <LegalSection title="3. 삭제되는 정보">
        <ul className="list-disc space-y-2 pl-5">
          <li>로그인 계정, 인증 세션과 푸시 알림 구독</li>
          <li>회원 프로필, 보호자 연결, 수업 신청과 출결 기록</li>
          <li>수련·승급·상담 기록과 건강 관련 주의사항</li>
          <li>공지 읽음 상태와 계정에 연결된 기타 서비스 데이터</li>
        </ul>
        <p>다른 회원의 정당한 이용 기록이나 법령상 보관 의무가 있는 거래 기록은 삭제 범위에서 제외될 수 있습니다.</p>
      </LegalSection>

      <LegalSection title="4. 처리 기간과 별도 보관">
        <p>요청을 접수하면 본인 확인 후 지체 없이 처리하고, 삭제 완료 또는 추가 확인이 필요한 사항을 요청한 연락처로 안내합니다.</p>
        <p>
          일반 서비스 기록은 이용 종료 후 2년 보관을 원칙으로 하지만, 명시적인 계정 삭제 요청이 접수되면 법령상 보관 의무가 있는
          정보를 제외하고 삭제합니다. 계약·청약철회 및 대금결제 기록은 5년, 소비자 불만·분쟁 처리 기록은 3년간 다른 정보와 분리해
          보관한 뒤 파기합니다.
        </p>
      </LegalSection>

      <LegalSection title="5. 문의">
        <p>운영자·개인정보 보호책임자: 조승권</p>
        <p>이메일: <a className="font-semibold text-teal-700 underline underline-offset-4" href="mailto:chosk88@naver.com">chosk88@naver.com</a></p>
        <p>전화: <a className="font-semibold text-teal-700 underline underline-offset-4" href="tel:01092970524">010-9297-0524</a></p>
        <p>주소: 서울특별시 강서구 등촌로 17</p>
        <p>
          개인정보 처리 전반은 <Link className="font-semibold text-teal-700 underline underline-offset-4" href="/privacy">개인정보처리방침</Link>에서
          확인할 수 있습니다.
        </p>
      </LegalSection>
    </LegalPageShell>
  );
}
