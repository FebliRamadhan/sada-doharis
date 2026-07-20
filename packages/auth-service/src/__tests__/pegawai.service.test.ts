import { describe, it, expect, vi, beforeEach } from 'vitest';

const executeMock = vi.fn();

vi.mock('mysql2/promise', () => ({
  default: {
    createPool: vi.fn(() => ({
      execute: executeMock,
      end: vi.fn(),
    })),
  },
}));

const { pegawaiService } = await import('../services/pegawai.service.js');

describe('pegawaiService', () => {
  beforeEach(() => {
    executeMock.mockReset();
  });

  describe('getByEmail', () => {
    it('returns jabatan and unit_kerja from the joined unit staf rows', async () => {
      executeMock.mockResolvedValueOnce([
        [
          {
            master_pegawai_id: 42,
            nip: '195705271978021001',
            nama: 'Subowo Djoko Widodo',
            nama_cetak: 'Subowo Djoko Widodo, S.H.',
            email: 'subowo.djoko@menpan.go.id',
            unit_staf_id: 104040000000,
            foto: null,
            dihapus: 'tidak',
            jabatan: 'Asisten Deputi Standardisasi Jabatan',
            unit_kerja: 'Deputi Bidang Sumber Daya Manusia Aparatur',
          },
        ],
      ]);

      const pegawai = await pegawaiService.getByEmail('subowo.djoko@menpan.go.id');

      expect(pegawai).not.toBeNull();
      expect(pegawai?.jabatan).toBe('Asisten Deputi Standardisasi Jabatan');
      expect(pegawai?.unit_kerja).toBe('Deputi Bidang Sumber Daya Manusia Aparatur');
      expect(pegawai?.nip).toBe('195705271978021001');

      const [sql, params] = executeMock.mock.calls[0];
      expect(sql).toContain('LEFT JOIN daf_unit_staf us ON us.unit_staf_id = p.unit_staf_id');
      expect(sql).toContain(
        'LEFT JOIN daf_unit_staf pu ON pu.unit_staf_id = us.parent_id_unit_kerja'
      );
      expect(params).toEqual(['subowo.djoko@menpan.go.id', 'subowo.djoko@menpan.go.id']);
    });

    it('maps NULL jabatan/unit_kerja to undefined when the unit is unresolved', async () => {
      executeMock.mockResolvedValueOnce([
        [
          {
            master_pegawai_id: 1,
            nip: '195503211980032001',
            nama: 'Staf Ahli',
            nama_cetak: null,
            email: 'staf.ahli@menpan.go.id',
            unit_staf_id: null,
            foto: null,
            dihapus: 'tidak',
            jabatan: null,
            unit_kerja: null,
          },
        ],
      ]);

      const pegawai = await pegawaiService.getByEmail('staf.ahli@menpan.go.id');

      expect(pegawai?.jabatan).toBeUndefined();
      expect(pegawai?.unit_kerja).toBeUndefined();
    });

    it('returns null when no row matches', async () => {
      executeMock.mockResolvedValueOnce([[]]);

      const pegawai = await pegawaiService.getByEmail('unknown@menpan.go.id');

      expect(pegawai).toBeNull();
    });
  });

  describe('getByNip', () => {
    it('returns jabatan and unit_kerja from the joined unit staf rows', async () => {
      executeMock.mockResolvedValueOnce([
        [
          {
            nip: '195806141980032001',
            nama: 'Siti Nurhayati',
            nama_cetak: null,
            email: 'siti.nurhayati@menpan.go.id',
            unit_staf_id: 284,
            foto: null,
            dihapus: 'tidak',
            jabatan: 'Sekretaris Deputi Bidang Kelembagaan dan Tata Laksana',
            unit_kerja: 'Sekretariat Deputi Bidang Kelembagaan dan Tata Laksana',
          },
        ],
      ]);

      const pegawai = await pegawaiService.getByNip('195806141980032001');

      expect(pegawai?.jabatan).toBe('Sekretaris Deputi Bidang Kelembagaan dan Tata Laksana');
      expect(pegawai?.unit_kerja).toBe('Sekretariat Deputi Bidang Kelembagaan dan Tata Laksana');
    });
  });
});
