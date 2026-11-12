import { describe, expect, it } from 'vitest';
import {
  normalizeDiagnoses,
  normalizeHisDate,
  normalizeProfile,
  normalizeVisits,
  normalizeVisitsByYear,
} from '../src/his/normalizers.js';
import { diagnosesResponse, profileResponse, SENSITIVE, visitsResponse, yearWiseResponse } from './fixtures/his.js';

describe('normalizeHisDate', () => {
  it('converts HIS date formats to sortable YYYY-MM-DD HH:mm', () => {
    expect(normalizeHisDate('12-Sep-2026 10:15:00')).toBe('2026-09-12 10:15');
    expect(normalizeHisDate('3-Mar-2026 09:30')).toBe('2026-03-03 09:30');
    expect(normalizeHisDate('01-Jul-1981')).toBe('1981-07-01');
  });

  it('returns unknown formats unchanged and empty values as undefined', () => {
    expect(normalizeHisDate('2026/09/12')).toBe('2026/09/12');
    expect(normalizeHisDate('')).toBeUndefined();
    expect(normalizeHisDate(undefined)).toBeUndefined();
  });
});

describe('normalizeProfile', () => {
  it('keeps clinical fields and drops PHI', () => {
    const profile = normalizeProfile(profileResponse);
    expect(profile).toEqual({
      name: 'TEST PATIENT',
      age: '45Y 3M',
      gender: 'Male',
      nationality: 'Saudi',
      bloodGroup: 'O+',
      height: '172',
      weight: '80',
      hasAllergies: true,
    });
    const serialized = JSON.stringify(profile);
    for (const value of Object.values(SENSITIVE)) expect(serialized).not.toContain(value);
    expect(serialized).not.toContain('<table');
  });

  it('returns null when the list is empty', () => {
    expect(normalizeProfile({ Code: 200, FetchPatientDataCCList: [] })).toBeNull();
  });

  it('reports pregnancy trimester when flagged', () => {
    const raw = {
      Code: 200,
      FetchPatientDataCCList: [{ ...profileResponse.FetchPatientDataCCList![0]!, IsPregnancy: 1, PregnancyContent: '2nd Tr' }],
    };
    expect(normalizeProfile(raw)?.pregnancy).toBe('2nd Tr');
  });
});

describe('normalizeVisits', () => {
  it('returns compact visits sorted newest first', () => {
    const visits = normalizeVisits(visitsResponse);
    expect(visits.map((v) => v.date)).toEqual(['2026-09-12 10:15', '2026-03-03 09:05']);
    expect(visits[0]).toEqual({
      date: '2026-09-12 10:15',
      visitType: 'ED',
      hospital: 'AHH Olaya',
      doctor: 'Dr. B',
      specialty: 'Internal Medicine',
      admissionId: '5002',
      isNewVisit: true,
    });
  });

  it('maps PatientType codes when PatientTypeName is missing', () => {
    const visits = normalizeVisits({ Code: 200, PatientVisitsDataList: [{ VisitDate: '01-Jan-2026 08:00:00', PatientType: '2' }] });
    expect(visits[0]?.visitType).toBe('IP');
  });

  it('handles a missing list', () => {
    expect(normalizeVisits({ Code: 200 })).toEqual([]);
  });
});

describe('normalizeVisitsByYear', () => {
  it('returns numeric counts per year and visit type, newest year first', () => {
    expect(normalizeVisitsByYear(yearWiseResponse)).toEqual([
      { year: 2026, visitType: 'OP', count: 4 },
      { year: 2026, visitType: 'ED', count: 1 },
      { year: 2025, visitType: 'OP', count: 3 },
    ]);
  });
});

describe('normalizeDiagnoses', () => {
  it('excludes blocked diagnoses', () => {
    const diagnoses = normalizeDiagnoses(diagnosesResponse);
    expect(diagnoses).toHaveLength(2);
    expect(JSON.stringify(diagnoses)).not.toContain('BLOCKED');
  });

  it('returns compact diagnoses sorted newest first', () => {
    const [latest] = normalizeDiagnoses(diagnosesResponse);
    expect(latest).toEqual({
      diagnosis: 'Acute bronchitis',
      icdCode: 'J20.9',
      type: 'Primary',
      status: 'Active',
      date: '2026-09-12 10:40',
      admissionId: '5002',
      doctor: 'Dr. B',
      hospital: 'AHH Olaya',
      visitType: 'ED',
    });
  });

  it('treats "True" as blocked', () => {
    const raw = { Code: 200, PatientDiseasesDataList: [{ DiseaseName: 'X', Blocked: 'True' }] };
    expect(normalizeDiagnoses(raw)).toEqual([]);
  });
});
