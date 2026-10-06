import { ParticipantDetail } from '@/components/participants/detail';
export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  return <ParticipantDetail id={(await params).id} />;
}
