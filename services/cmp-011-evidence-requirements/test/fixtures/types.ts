export interface OptionOut {
  source: string;
  availability: string;
  recommended: boolean;
}
export interface ItemOut {
  options: OptionOut[];
  rejections: { reason_code: string }[];
}
export interface SetOut {
  set_code: string;
  items: ItemOut[];
}
export interface ReqOut {
  requirement_code: string;
  status: string;
  alternative_sets: SetOut[];
}
