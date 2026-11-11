import { Inject, Injectable, Logger } from "@nestjs/common";
import { createTransport, type Transporter } from "nodemailer";

import { WorkerConfig } from "./config.js";

export interface Mail {
    to: string
    subject: string
    text: string
}

/** SMTP when SMTP_HOST is set; otherwise every mail is logged and dropped. */
@Injectable()
export class Mailer {
    private readonly logger = new Logger(Mailer.name);
    private transport?: Transporter;

    constructor (@Inject(WorkerConfig) private readonly config: WorkerConfig) {}

    isConfigured () {
        return Boolean(this.config.env.SMTP_HOST);
    }

    async send (mail: Mail) {
        const { env } = this.config;
        if (!this.isConfigured()) {
            this.logger.log(`SMTP not configured, not sending "${mail.subject}"`);
            return;
        }
        this.transport ??= createTransport({
            host: env.SMTP_HOST,
            port: env.SMTP_PORT,
            secure: env.SMTP_PORT === 465,
            auth: env.SMTP_USER ? { user: env.SMTP_USER, pass: env.SMTP_PASS } : undefined
        });
        await this.transport.sendMail({ from: env.SMTP_FROM, ...mail });
    }
}
