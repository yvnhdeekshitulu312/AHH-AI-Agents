/**
 * Raw ClinicalsAPI response shapes (ASP.NET Web API 2, PascalCase).
 * Derived from the DoctorPortalAPI models; see docs/HIS_API_RESPONSES.md.
 * Every field is optional because the API serializes DataRow values loosely.
 */

/** Common envelope (`Base`). Code: 200 = Success, 404 = Fail, 604/605 = validation/error. */
export interface HisEnvelope {
  Code?: number;
  Status?: string;
  Message?: string;
  Message2L?: string;
}

export interface RawPatientProfile {
  PatientID?: string;
  RegCode?: string;
  PatientName?: string;
  FullAge?: string;
  Gender?: string;
  GenderType?: string;
  Nationality?: string;
  BloodGroup?: string;
  Height?: string;
  Weight?: string;
  IsAllergy?: number | string;
  IsPregnancy?: number | string;
  PregnancyContent?: string;
  Lactation?: string;
  ISVIP?: string;
  /** Used server-side only (lab reference ranges depend on gender + age); never sent to the LLM. */
  GenderID?: string;
  /** Used server-side only (lab reference ranges); never sent to the LLM. "dd-MMM-yyyy HH:mm". */
  DOB?: string;
  // Present in the response but deliberately never used (PHI / not needed):
  SSN?: string;
  MobileNo?: string;
  InsuranceNo?: string;
  AllergyData?: string;
  Discription?: string;
}

export interface RawPatientProfileResponse extends HisEnvelope {
  FetchPatientDataCCList?: RawPatientProfile[];
}

export interface RawVisit {
  PatientID?: string;
  VisitDate?: string;
  AdmissionID?: string;
  HospitalID?: string;
  HospitalName?: string;
  DoctorID?: string;
  DoctorName?: string;
  SpecialiseID?: string;
  SpecialisationName?: string;
  PatientType?: string;
  PatientTypeName?: string;
  IsNewVisit?: string;
}

export interface RawVisitsResponse extends HisEnvelope {
  PatientVisitsDataList?: RawVisit[];
}

export interface RawYearWiseVisit {
  PatientType?: string;
  YearID?: string;
  /** Actually the visit count for that year + patient type. */
  TotalPatients?: string;
}

export interface RawYearWiseVisitsResponse extends HisEnvelope {
  FetchyearWisePatientVisitsDataList?: RawYearWiseVisit[];
}

export interface RawDiagnosis {
  DiseaseID?: string;
  DiseaseName?: string;
  /** ICD code (inside the item, not the envelope Code). */
  Code?: string;
  DiagnosisType?: string;
  DiagonosisType?: string;
  DiagnosisStatus?: string;
  AdmissionID?: string;
  CreateDate?: string;
  Doctorname?: string;
  HospitalName?: string;
  PatientType?: string;
  Remarks?: string;
  Blocked?: string;
  IsPfVisible?: string;
  IsPsd?: string;
}

export interface RawDiagnosesResponse extends HisEnvelope {
  PatientDiseasesDataList?: RawDiagnosis[];
}

/**
 * One ordered test/investigation. Shared by the lab list (FetchLabOrderResultsPFN) and the
 * radiology / cardiology / neurology / dental lists (Fetch*OrderResultsPF).
 * Lists carry status and HIS flags only: lab values come from FetchPrevLabTestComponents, and
 * report text for the other departments is only available as PDF.
 */
export interface RawOrderResult {
  TestOrderId?: string;
  TestOrderItemID?: string;
  TestId?: string;
  TestName?: string;
  specialisation?: string;
  DepartmentName?: string;
  /** Serialized DateTime, e.g. "2026-10-05T10:15:00". */
  OrderDate?: string;
  Status?: string;
  StatusName?: string;
  /** "True" when the HIS flagged a panic (critical) result. */
  IsPanic?: string;
  /** "True" when the HIS flagged an abnormal result. */
  IsAbnormal?: string;
  IsPreliminary?: string;
  /** "4" = resulted (lab), "7" = resulted (other departments). */
  IsResult?: string;
  PatientType?: string;
  SampleNumber?: string;
  /** "dd-MMM-yyyy HH:mm" */
  SampleCollectedAt?: string;
  ResultEnteredAt?: string;
  ResultVerifiedAt?: string;
  ResultVerifiedByName?: string;
  DocName?: string;
  HospitalID?: string;
  HospitalName?: string;
}

export interface RawLabResultsResponse extends HisEnvelope {
  FetchLabOrderResultsDataaList?: RawOrderResult[];
}

/** Radiology, cardiology and dental return FetchRadOrderResultsDataaList; neurology returns FetchLabOrderResultsDataaList. */
export interface RawDepartmentResultsResponse extends HisEnvelope {
  FetchRadOrderResultsDataaList?: RawOrderResult[];
  FetchLabOrderResultsDataaList?: RawOrderResult[];
}

/** One parameter (component) of a lab test, with its value and reference / panic limits. */
export interface RawLabComponent {
  TestID?: string;
  TestCompID?: string;
  ParameterName?: string;
  Seq?: string;
  /** The result value. */
  TextValue?: string;
  /** The previous result for the same parameter. */
  PrevTextValue?: string;
  Unitname?: string;
  MinLimit?: string;
  MaxLimit?: string;
  PanicMin?: string;
  PanicMax?: string;
  /** Formatted reference range text. */
  RRValue?: string;
}

export interface RawLabComponentsResponse extends HisEnvelope {
  FetchLabTestComponentsListM?: RawLabComponent[];
}
