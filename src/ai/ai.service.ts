import { Injectable, Logger } from '@nestjs/common';
import { GoogleGenerativeAI } from '@google/generative-ai';
import { ConfigService } from '@nestjs/config';
import OpenAI from 'openai';

@Injectable()
export class AiService {
  private readonly logger = new Logger(AiService.name);
  private genAI: GoogleGenerativeAI | null = null;
  private groq: OpenAI | null = null;

  constructor(private configService: ConfigService) {
    const geminiKey = this.configService.get<string>('GEMINI_API_KEY');
    const groqKey = this.configService.get<string>('GROQ_API_KEY');

    if (geminiKey) this.genAI = new GoogleGenerativeAI(geminiKey);
    if (groqKey) this.groq = new OpenAI({
      apiKey: groqKey,
      baseURL: 'https://api.groq.com/openai/v1',
    });

    if (!geminiKey && !groqKey) {
      this.logger.warn('Tidak ada API key LLM yang diset.');
    }
  }

  private buildPrompt(subject: string, message: string): string {
    return `Anda adalah asisten AI untuk layanan pelanggan.
Analisis tiket berikut:
Subjek: "${subject}"
Pesan: "${message}"

Tugas Anda:
1. Klasifikasikan kategori tiket secara ketat ke salah satu dari: "billing", "technical", atau "general".
2. Buat draf balasan singkat untuk membantu agen (suggested_reply) dalam bahasa yang sama dengan pesan pelanggan.

PENTING: Jawab HANYA menggunakan format JSON murni tanpa tambahan teks, tanpa markdown. Format:
{
  "category": "...",
  "suggested_reply": "..."
}`;
  }

  private parseResponse(text: string): { category: string; suggested_reply: string } | null {
    try {
      const clean = text.replace(/```json/g, '').replace(/```/g, '').trim();
      const parsed = JSON.parse(clean);
      const validCategories = ['billing', 'technical', 'general'];
      return {
        category: validCategories.includes(parsed.category) ? parsed.category : 'general',
        suggested_reply: parsed.suggested_reply || null,
      };
    } catch {
      return null;
    }
  }

  async analyzeTicket(subject: string, message: string) {
    const fallbackResult = { category: null, suggested_reply: null };
    const prompt = this.buildPrompt(subject, message);

    // Coba Gemini dulu
    if (this.genAI) {
      try {
        const model = this.genAI.getGenerativeModel({ model: 'gemini-3.8-flash' });
        const result = await model.generateContent(prompt);
        const parsed = this.parseResponse(result.response.text());
        if (parsed) {
          this.logger.log('LLM: Gemini berhasil');
          return parsed;
        }
      } catch (err) {
        this.logger.warn(`Gemini gagal, coba Groq: ${(err as Error).message}`);
      }
    }

    // Fallback ke Groq
    if (this.groq) {
      try {
        const completion = await this.groq.chat.completions.create({
          model: 'openai/gpt-oss-20b',
          messages: [{ role: 'user', content: prompt }],
          temperature: 0.3,
        });
        const text = completion.choices[0]?.message?.content ?? '';
        const parsed = this.parseResponse(text);
        if (parsed) {
          this.logger.log('LLM: Groq berhasil (fallback)');
          return parsed;
        }
      } catch (err) {
        this.logger.warn(`Groq gagal: ${(err as Error).message}`);
      }
    }

    this.logger.error('Semua LLM gagal, tiket disimpan tanpa klasifikasi.');
    return fallbackResult;
  }
}