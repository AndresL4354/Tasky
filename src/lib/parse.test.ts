import { describe, expect, it } from 'vitest';
import { normalizeTag, parseDate, parseEntry } from './parse';

const TODAY = '2026-11-07'; // sábado

describe('parseEntry', () => {
  it('separa título, etiquetas, prioridad y fecha', () => {
    expect(parseEntry('Arreglar login #auth #Backend !alta @15/11', TODAY)).toEqual({
      title: 'Arreglar login',
      tags: ['#auth', '#backend'],
      priority: 3,
      due: '2026-11-15',
    });
  });

  it('acepta formas cortas de prioridad', () => {
    expect(parseEntry('a !m', TODAY).priority).toBe(2);
    expect(parseEntry('a !1', TODAY).priority).toBe(1);
  });

  it('deja en el título lo que no es una marca válida', () => {
    const p = parseEntry('Escribir a @juan sobre #  el plan !urgente', TODAY);
    expect(p.title).toBe('Escribir a @juan sobre # el plan !urgente');
    expect(p.tags).toEqual([]);
    expect(p.priority).toBeNull();
    expect(p.due).toBeNull();
  });

  it('no duplica etiquetas y soporta acentos', () => {
    expect(parseEntry('x #diseño #Diseño', TODAY).tags).toEqual(['#diseño']);
  });

  it('título vacío cuando solo hay marcas', () => {
    expect(parseEntry('#tag !alta', TODAY).title).toBe('');
  });
});

describe('parseDate', () => {
  it('hoy, mañana y días de la semana', () => {
    expect(parseDate('hoy', TODAY)).toBe('2026-11-07');
    expect(parseDate('mañana', TODAY)).toBe('2026-11-08');
    expect(parseDate('lunes', TODAY)).toBe('2026-11-09');
    expect(parseDate('sabado', TODAY)).toBe('2026-11-14');
  });

  it('dd/mm asume el año siguiente si ya pasó', () => {
    expect(parseDate('3/11', TODAY)).toBe('2027-11-03');
    expect(parseDate('20/12', TODAY)).toBe('2026-12-20');
    expect(parseDate('1/2/27', TODAY)).toBe('2027-02-01');
  });

  it('rechaza fechas imposibles', () => {
    expect(parseDate('31/2', TODAY)).toBeNull();
    expect(parseDate('juan', TODAY)).toBeNull();
  });

  it('acepta ISO', () => {
    expect(parseDate('2026-12-01', TODAY)).toBe('2026-12-01');
  });
});

describe('normalizeTag', () => {
  it('agrega # y convierte espacios', () => {
    expect(normalizeTag('Front End')).toBe('#front-end');
    expect(normalizeTag('##bug')).toBe('#bug');
    expect(normalizeTag('  ')).toBeNull();
  });
});
