import type {
  RawDepartmentResultsResponse,
  RawLabComponentsResponse,
  RawLabResultsResponse,
  RawDiagnosesResponse,
  RawPatientProfileResponse,
  RawVisitsResponse,
  RawYearWiseVisitsResponse,
} from '../../src/his/types.js';

/** Synthetic data shaped like the ClinicalsAPI responses (see docs/HIS_API_RESPONSES.md). Not real patients. */

export const SENSITIVE = {
  ssn: '1098765432',
  mobile: '0550000000',
  insuranceNo: 'INS-99887766',
};

export const profileResponse: RawPatientProfileResponse = {
  Code: 200,
  Status: 'Success',
  Message: '',
  Message2L: '',
  FetchPatientDataCCList: [
    {
      PatientID: '123456',
      RegCode: 'AHH.0001234',
      PatientName: 'TEST PATIENT',
      FullAge: '45Y 3M',
      Gender: 'Male',
      GenderType: 'Male',
      Nationality: 'Saudi',
      BloodGroup: 'O+',
      Height: '172',
      Weight: '80',
      IsAllergy: 1,
      IsPregnancy: 0,
      PregnancyContent: '',
      Lactation: '',
      ISVIP: '0',
      SSN: SENSITIVE.ssn,
      MobileNo: SENSITIVE.mobile,
      InsuranceNo: SENSITIVE.insuranceNo,
      DOB: '01-Jul-1981 00:00',
      GenderID: '1',
      AllergyData: "<table class='table'><tr><td>Penicillin</td></tr></table>",
      Discription: 'UHID is Blocked.</br>',
    },
  ],
};

export const visitsResponse: RawVisitsResponse = {
  Code: 200,
  Status: 'Success',
  Message: '',
  PatientVisitsDataList: [
    {
      PatientID: '123456',
      VisitDate: '03-Mar-2026 09:05:00',
      AdmissionID: '5001',
      HospitalName: 'AHH Olaya',
      DoctorName: 'Dr. A',
      SpecialisationName: 'Cardiology',
      PatientType: '1',
      PatientTypeName: 'OP',
      IsNewVisit: '0',
    },
    {
      PatientID: '123456',
      VisitDate: '12-Sep-2026 10:15:00',
      AdmissionID: '5002',
      HospitalName: 'AHH Olaya',
      DoctorName: 'Dr. B',
      SpecialisationName: 'Internal Medicine',
      PatientType: '3',
      PatientTypeName: 'ED',
      IsNewVisit: '1',
    },
  ],
};

export const yearWiseResponse: RawYearWiseVisitsResponse = {
  Code: 200,
  Status: 'Success',
  Message: '',
  FetchyearWisePatientVisitsDataList: [
    { PatientType: '1', YearID: '2025', TotalPatients: '3' },
    { PatientType: '1', YearID: '2026', TotalPatients: '4' },
    { PatientType: '3', YearID: '2026', TotalPatients: '1' },
  ],
};

export const diagnosesResponse: RawDiagnosesResponse = {
  Code: 200,
  Status: 'Success',
  Message: '',
  PatientDiseasesDataList: [
    {
      DiseaseName: 'Essential hypertension',
      Code: 'I10',
      DiagnosisType: 'Primary',
      DiagnosisStatus: 'Active',
      AdmissionID: '5001',
      CreateDate: '03-Mar-2026 09:30',
      Doctorname: 'Dr. A',
      HospitalName: 'AHH Olaya',
      PatientType: '1',
      Blocked: '0',
    },
    {
      DiseaseName: 'Acute bronchitis',
      Code: 'J20.9',
      DiagnosisType: 'Primary',
      DiagnosisStatus: 'Active',
      AdmissionID: '5002',
      CreateDate: '12-Sep-2026 10:40',
      Doctorname: 'Dr. B',
      HospitalName: 'AHH Olaya',
      PatientType: '3',
      Blocked: '0',
    },
    {
      DiseaseName: 'BLOCKED CONFIDENTIAL DIAGNOSIS',
      Code: 'F32.9',
      AdmissionID: '5002',
      CreateDate: '12-Sep-2026 11:00',
      Blocked: '1',
    },
  ],
};

export const failEnvelope = {
  Code: 404,
  Status: 'Fail',
  Message: 'System.Data.SqlClient.SqlException: Invalid column name ...',
};

/** Lab list: panic potassium, abnormal CBC, normal TSH, and one not-yet-resulted order. */
export const labResultsResponse: RawLabResultsResponse = {
  Code: 200,
  Status: 'Success',
  Message: '',
  FetchLabOrderResultsDataaList: [
    {
      TestOrderItemID: '9001', TestOrderId: '700', TestId: '41', TestName: 'Potassium', specialisation: 'Chemistry',
      OrderDate: '2026-10-05T08:10:00', SampleCollectedAt: '05-Oct-2026 08:30', ResultVerifiedAt: '05-Oct-2026 10:05',
      StatusName: 'Verified', IsPanic: 'True', IsAbnormal: 'True', IsPreliminary: 'False', IsResult: '4',
      PatientType: '2', SampleNumber: 'S-1', HospitalID: '3', HospitalName: 'AHH Olaya', ResultVerifiedByName: 'Lab Tech A',
    },
    {
      TestOrderItemID: '9002', TestOrderId: '701', TestId: '12', TestName: 'CBC', specialisation: 'Hematology',
      OrderDate: '2026-10-03T07:00:00', SampleCollectedAt: '03-Oct-2026 07:20', StatusName: 'Verified',
      IsPanic: 'False', IsAbnormal: 'True', IsPreliminary: 'True', IsResult: '4', PatientType: '2', HospitalID: '3',
    },
    {
      TestOrderItemID: '9003', TestOrderId: '702', TestId: '88', TestName: 'TSH', OrderDate: '2026-09-20T09:00:00',
      StatusName: 'Verified', IsPanic: 'False', IsAbnormal: 'False', IsResult: '4', PatientType: '1', HospitalID: '3',
    },
    {
      TestOrderItemID: '9004', TestOrderId: '703', TestId: '50', TestName: 'HbA1c', OrderDate: '2026-10-06T09:00:00',
      StatusName: 'Sample Collected', IsPanic: 'False', IsAbnormal: 'False', IsResult: '1', PatientType: '2', HospitalID: '3',
    },
  ],
};

export const potassiumComponentsResponse: RawLabComponentsResponse = {
  Code: 200,
  Status: 'Success',
  Message: '',
  FetchLabTestComponentsListM: [
    {
      TestID: '41', ParameterName: 'Potassium', Seq: '1', TextValue: '6.8', PrevTextValue: '5.0', Unitname: 'mmol/L',
      MinLimit: '3.5', MaxLimit: '5.1', PanicMin: '2.8', PanicMax: '6.2', RRValue: '3.5 - 5.1 mmol/L',
    },
    { TestID: '41', ParameterName: 'Comment', Seq: '2', TextValue: '', Unitname: '' },
  ],
};

export const radiologyResponse: RawDepartmentResultsResponse = {
  Code: 200,
  Status: 'Success',
  Message: '',
  FetchRadOrderResultsDataaList: [
    {
      TestOrderItemID: '8001', TestName: 'CT Chest', OrderDate: '2026-10-04T12:00:00', StatusName: 'Verified',
      IsPanic: 'False', IsAbnormal: 'True', IsResult: '7', HospitalName: 'AHH Olaya',
    },
    { TestOrderItemID: '8002', TestName: 'Chest X-ray', OrderDate: '2026-10-06T12:00:00', StatusName: 'Ordered', IsResult: '1' },
  ],
};

/** Neurology uses the lab list name. */
export const neurologyResponse: RawDepartmentResultsResponse = {
  Code: 200,
  Status: 'Success',
  Message: '',
  FetchLabOrderResultsDataaList: [
    { TestOrderItemID: '8101', TestName: 'EEG', OrderDate: '2026-09-28T10:00:00', StatusName: 'Verified', IsPanic: 'False', IsAbnormal: 'False', IsResult: '7' },
  ],
};

export const emptyDepartmentResponse: RawDepartmentResultsResponse = {
  Code: 200,
  Status: 'Success',
  Message: 'No Records Found',
  FetchRadOrderResultsDataaList: [],
};
