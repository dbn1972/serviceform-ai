import type { Metadata } from 'next';
import { ApplyPage } from '../../../../components/ApplyPage';

export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
  title: 'Apply - Residence Certificate - ServiceForm AI - Citizen Portal',
};

export default function ResidenceApplyPage() {
  return <ApplyPage catalogueId="IND-SOC-002" />;
}
