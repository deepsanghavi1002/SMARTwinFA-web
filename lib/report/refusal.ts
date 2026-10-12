/** A selection the C# refuses: Generate shows the message (and caption) and stops. */
export class ReportRefusal extends Error {
  readonly caption: string;

  constructor(message: string, caption = "Report generation failed") {
    super(message);
    this.caption = caption;
  }
}
