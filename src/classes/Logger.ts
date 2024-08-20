export class Logger {
    private static instance: Logger;
    private debug: boolean;

    private constructor(debug: boolean) {
        this.debug = debug;
    }

    public static getInstance(debug: boolean = false): Logger {
        if (!Logger.instance) Logger.instance = new Logger(debug);

        return Logger.instance;
    }

    public log(message: any): void {
        if (this.debug) console.log(message);
    }

    public error(message: any): void {
        if (this.debug) console.error(message);
    }
}
