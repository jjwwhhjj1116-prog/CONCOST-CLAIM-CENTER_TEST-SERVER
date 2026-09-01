import brandLogo from './proposal-template-assets/BRAND_LOGO.jpg';
import chapter04ExpertProfile from './proposal-template-assets/CH04_EXPERT_PROFILE.jpg';
import chapter06BusinessAreas from './proposal-template-assets/CH06_BUSINESS_AREAS.jpg';
import chapter06Organization from './proposal-template-assets/CH06_ORG_CHART.jpg';
import chapter10Appraiser from './proposal-template-assets/CH10_APPRAISER.jpg';
import chapter10Degree from './proposal-template-assets/CH10_DEGREE.jpg';
import chapter10Publications from './proposal-template-assets/CH10_PUBLICATIONS.jpg';

export interface BundledProposalTemplateAsset {
  assetKey: string;
  bytes: Uint8Array;
  fileName: string;
  height: number;
  mimeType: 'image/jpeg';
  width: number;
}

const asset = (assetKey:string,fileName:string,width:number,height:number,source:unknown):BundledProposalTemplateAsset => ({
  assetKey,
  bytes:new Uint8Array(source as ArrayBuffer),
  fileName,
  height,
  mimeType:'image/jpeg',
  width,
});

// These are the seven images embedded in the user-supplied 260728 HWP.
// Keeping them in the authenticated Worker bundle prevents certificates and
// profile material from being exposed as anonymous public-site assets.
export const BUNDLED_PROPOSAL_TEMPLATE_ASSETS:BundledProposalTemplateAsset[] = [
  asset('BRAND_LOGO','CONCOST-logo.jpg',341,239,brandLogo),
  asset('CH04_EXPERT_PROFILE','CH04-expert-profile.jpg',947,764,chapter04ExpertProfile),
  asset('CH06_ORG_CHART','CH06-organization-chart.jpg',960,540,chapter06Organization),
  asset('CH06_BUSINESS_AREAS','CH06-business-areas.jpg',960,540,chapter06BusinessAreas),
  asset('CH10_DEGREE','CH10-degree-certificate.jpg',571,820,chapter10Degree),
  asset('CH10_APPRAISER','CH10-appraiser-certificate.jpg',525,698,chapter10Appraiser),
  asset('CH10_PUBLICATIONS','CH10-publications.jpg',1077,562,chapter10Publications),
];
