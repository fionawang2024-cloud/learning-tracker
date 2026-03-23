import StudentTabSwitcher from "@/components/student/StudentTabSwitcher";

export default function StudentLayout({ children }) {
  return (
    <div className="student-layout min-w-0">
      <StudentTabSwitcher />
      {children}
    </div>
  );
}
