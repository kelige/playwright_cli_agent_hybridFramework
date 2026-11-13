/**
 * DVS shared helpers
 * @description Synthetic-only test data and role environment key lookups.
 */

export class Helper {
    static getDvsTestRunId(): string {
        const timestamp = Date.now();
        const randomSuffix = Math.random().toString(36).slice(2, 8).toUpperCase();
        return `DVS-RUN-${timestamp}-${randomSuffix}`;
    }

    static getAcademicConfigurationData() {
        return {
            programmeCode: 'DVS-AUTO-BCA',
            programmeName: 'Automation Test - Bachelor of Computer Applications',
            regulationCode: 'DVS-AUTO-REG-01',
            regulationTitle: 'Automation Test Regulation',
            academicYear: '2098-99',
            termName: 'Semester 1',
            termSequence: 1,
            examSessionName: 'DVS Automation Session 01',
            courseCode: 'DVS-AUTO-COURSE-01',
            courseName: 'Automation Test Course',
        };
    }

    static getPaperConfigurationData() {
        return {
            paperCode: 'DVS-AUTO-KAN001',
            paperTitle: 'Automation Test Paper',
            subjectCode: 'DVS-AUTO-SUB001',
            subjectName: 'Automation Test Subject',
            maximumMarks: 100,
            passingMarks: 35,
            scriptsPerPacket: 2,
            pagesPerScript: 4,
        };
    }

    static getRoleEnvironmentKey(role: string): {
        email: string;
        password: string;
    } {
        const roleEnvironmentKeys: Record<
            string,
            { email: string; password: string }
        > = {
            admin: { email: 'DVS_ADMIN_EMAIL', password: 'DVS_ADMIN_PASSWORD' },
            chairman: {
                email: 'DVS_CHAIRMAN_EMAIL',
                password: 'DVS_CHAIRMAN_PASSWORD',
            },
            chief: { email: 'DVS_CHIEF_EMAIL', password: 'DVS_CHIEF_PASSWORD' },
            evaluator: {
                email: 'DVS_EVALUATOR_EMAIL',
                password: 'DVS_EVALUATOR_PASSWORD',
            },
            scanningOperator: {
                email: 'DVS_SCANNER_EMAIL',
                password: 'DVS_SCANNER_PASSWORD',
            },
            scanner_operator: {
                email: 'DVS_SCANNER_EMAIL',
                password: 'DVS_SCANNER_PASSWORD',
            },
            userManager: {
                email: 'DVS_USER_MANAGER_EMAIL',
                password: 'DVS_USER_MANAGER_PASSWORD',
            },
            user_manager: {
                email: 'DVS_USER_MANAGER_EMAIL',
                password: 'DVS_USER_MANAGER_PASSWORD',
            },
        };

        const keys = roleEnvironmentKeys[role];
        if (!keys) {
            throw new Error(`Unknown role: ${role}`);
        }

        return keys;
    }
}
