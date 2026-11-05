import type { Metadata } from 'next';
import { ApplyPage } from '../../../../components/ApplyPage';

export const dynamic = 'force-dynamic';

export const metadata: Metadata = { title: 'Apply - ServiceForm AI - Citizen Portal' };

type Props = { params: Promise<{ catalogueId: string }> };

export default async function GenericApplyPage({ params }: Props) {
  return <ApplyPage catalogueId={(await params).catalogueId} />;
}
