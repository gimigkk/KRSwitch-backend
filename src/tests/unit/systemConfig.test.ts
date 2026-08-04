import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { Request, Response, NextFunction } from 'express';
import fs from 'fs';
import path from 'path';
import { isBarterEnabled, setBarterEnabled, loadSystemConfig } from '../../utils/systemConfig';
import { requireBarterEnabled } from '../../middleware/requireBarterEnabled';

const CONFIG_PATH = path.join(process.cwd(), 'storage', 'system-config.json');

describe('systemConfig utility & requireBarterEnabled middleware', () => {
  let initialConfigExists = false;
  let initialConfigContent: string | null = null;

  beforeEach(() => {
    // Preserve any existing real system config
    if (fs.existsSync(CONFIG_PATH)) {
      initialConfigExists = true;
      initialConfigContent = fs.readFileSync(CONFIG_PATH, 'utf-8');
    } else {
      initialConfigExists = false;
      initialConfigContent = null;
    }
    // Default to true before each test
    setBarterEnabled(true);
  });

  afterEach(() => {
    // Restore initial state
    if (initialConfigExists && initialConfigContent !== null) {
      fs.writeFileSync(CONFIG_PATH, initialConfigContent, 'utf-8');
      loadSystemConfig();
    } else {
      if (fs.existsSync(CONFIG_PATH)) {
        fs.unlinkSync(CONFIG_PATH);
      }
      setBarterEnabled(true);
    }
  });

  describe('isBarterEnabled & setBarterEnabled', () => {
    it('defaults to true', () => {
      expect(isBarterEnabled()).toBe(true);
    });

    it('toggles to false and persists to disk', () => {
      setBarterEnabled(false);
      expect(isBarterEnabled()).toBe(false);
      expect(fs.existsSync(CONFIG_PATH)).toBe(true);

      const saved = JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf-8'));
      expect(saved.barterEnabled).toBe(false);
    });

    it('toggles back to true and persists to disk', () => {
      setBarterEnabled(false);
      setBarterEnabled(true);
      expect(isBarterEnabled()).toBe(true);

      const saved = JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf-8'));
      expect(saved.barterEnabled).toBe(true);
    });

    it('loads persisted config from disk correctly', () => {
      setBarterEnabled(false);
      // Reset in-memory flag manually to test loadSystemConfig
      setBarterEnabled(true);
      expect(isBarterEnabled()).toBe(true);

      // Now set file to false manually and call loadSystemConfig
      fs.writeFileSync(CONFIG_PATH, JSON.stringify({ barterEnabled: false }), 'utf-8');
      loadSystemConfig();
      expect(isBarterEnabled()).toBe(false);
    });
  });

  describe('requireBarterEnabled middleware', () => {
    function makeRes() {
      const res: Partial<Response> = {
        status: vi.fn().mockReturnThis(),
        json: vi.fn().mockReturnThis(),
      };
      return res as Response;
    }

    it('calls next() when barter is enabled', () => {
      setBarterEnabled(true);
      const req = {} as Request;
      const res = makeRes();
      const next = vi.fn() as NextFunction;

      requireBarterEnabled(req, res, next);

      expect(next).toHaveBeenCalledOnce();
      expect(res.status).not.toHaveBeenCalled();
    });

    it('returns 403 with error message and barterDisabled=true when barter is disabled', () => {
      setBarterEnabled(false);
      const req = {} as Request;
      const res = makeRes();
      const next = vi.fn() as NextFunction;

      requireBarterEnabled(req, res, next);

      expect(next).not.toHaveBeenCalled();
      expect(res.status).toHaveBeenCalledWith(403);
      expect(res.json).toHaveBeenCalledWith({
        error: 'Sistem barter sedang ditutup oleh admin. Silakan tunggu pengumuman selanjutnya.',
        barterDisabled: true,
      });
    });
  });
});
