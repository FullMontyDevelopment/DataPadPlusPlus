import type { ComponentType, SVGProps } from 'react'
import {
  AlertTriangle,
  Activity,
  ArrowDownToLine,
  ArrowLeft,
  ArrowRight,
  ArrowUpToLine,
  Archive,
  Asterisk,
  Binary,
  BookMarked,
  Box,
  Boxes,
  Braces,
  Brackets,
  ChartLine,
  ChevronDown,
  ChevronRight,
  Circle,
  CircleCheck,
  CircleStop,
  Clock,
  Columns3,
  Copy,
  Database,
  DatabaseZap,
  Download,
  Eye,
  EyeOff,
  FileCode2,
  FileJson,
  FilePlus2,
  FlaskConical,
  Folder,
  FolderTree,
  Gauge,
  GitBranch,
  Hash,
  History,
  HardDrive,
  KeyRound,
  Layers3,
  List,
  LockKeyhole,
  LockKeyholeOpen,
  MemoryStick,
  Moon,
  MoreVertical,
  Network,
  Palette,
  PanelBottom,
  PencilLine,
  Play,
  RefreshCw,
  Route,
  Save,
  Search,
  Server,
  ServerCog,
  Settings,
  ShieldCheck,
  Shield,
  Sigma,
  SquareFunction,
  SquareStack,
  Star,
  Sun,
  Table2,
  Terminal,
  Trash2,
  Upload,
  UserRound,
  View,
  Waypoints,
  Webhook,
  Workflow,
  X,
} from 'lucide-react'
import type { LucideProps } from 'lucide-react'

type IconProps = SVGProps<SVGSVGElement>
type IconComponent = ComponentType<LucideProps>

function adapt(Icon: IconComponent) {
  return function WorkbenchIcon(props: IconProps) {
    return <Icon aria-hidden="true" strokeWidth={1.7} {...props} />
  }
}

export const LogoMark = adapt(Boxes)
export const ConnectionsIcon = adapt(Server)
export const EnvironmentsIcon = adapt(Layers3)
export const ExplorerIcon = adapt(FolderTree)
export const SavedWorkIcon = adapt(BookMarked)
export const TestsIcon = adapt(FlaskConical)
export const SearchIcon = adapt(Search)
export const SettingsIcon = adapt(Settings)
export const ThemeIcon = adapt(Moon)
export const ChevronRightIcon = adapt(ChevronRight)
export const ChevronDownIcon = adapt(ChevronDown)
export const PanelIcon = adapt(PanelBottom)
export const RenameIcon = adapt(PencilLine)
export const PlayIcon = adapt(Play)
export const StopIcon = adapt(CircleStop)
export const RefreshIcon = adapt(RefreshCw)
export const CloseIcon = adapt(X)
export const PlusIcon = adapt(FilePlus2)
export const QueryIcon = adapt(FileCode2)
export const DatabaseIcon = adapt(Database)
export const ObjectDatabaseIcon = adapt(Database)
export const ObjectSchemaIcon = adapt(FolderTree)
export const ObjectFolderIcon = adapt(Folder)
export const ObjectTableIcon = adapt(Table2)
export const ObjectViewIcon = adapt(View)
export const ObjectColumnIcon = adapt(Columns3)
export const ObjectIndexIcon = adapt(Hash)
export const ObjectConstraintIcon = adapt(Shield)
export const ObjectFunctionIcon = adapt(SquareFunction)
export const ObjectProcedureIcon = adapt(Workflow)
export const ObjectTriggerIcon = adapt(Webhook)
export const ObjectDocumentIcon = adapt(FileJson)
export const ObjectCollectionIcon = adapt(Braces)
export const ObjectKeyIcon = adapt(KeyRound)
export const ObjectPrefixIcon = adapt(Folder)
export const ObjectHashIcon = adapt(Hash)
export const ObjectListIcon = adapt(List)
export const ObjectSetIcon = adapt(SquareStack)
export const ObjectStreamIcon = adapt(Route)
export const ObjectSearchIcon = adapt(Search)
export const ObjectMappingIcon = adapt(Brackets)
export const ObjectGraphIcon = adapt(Network)
export const ObjectRelationshipIcon = adapt(GitBranch)
export const ObjectMetricIcon = adapt(ChartLine)
export const ObjectSeriesIcon = adapt(Activity)
export const ObjectBucketIcon = adapt(Archive)
export const ObjectJobIcon = adapt(Clock)
export const ObjectRoleIcon = adapt(UserRound)
export const ObjectSecurityIcon = adapt(LockKeyhole)
export const LockIcon = adapt(LockKeyhole)
export const UnlockIcon = adapt(LockKeyholeOpen)
export const ObjectStageIcon = adapt(Box)
export const ObjectWarehouseIcon = adapt(HardDrive)
export const ObjectServerIcon = adapt(ServerCog)
export const ObjectPackageIcon = adapt(Boxes)
export const ObjectTypeIcon = adapt(Sigma)
export const ObjectPartitionIcon = adapt(Waypoints)
export const ObjectBinaryIcon = adapt(Binary)
export const ObjectMemoryIcon = adapt(MemoryStick)
export const EfficiencyIcon = adapt(DatabaseZap)
export const ObjectGenericIcon = adapt(Asterisk)
export const WarningIcon = adapt(AlertTriangle)
export const ConnectionUnknownIcon = adapt(Circle)
export const ConnectionConnectedIcon = adapt(CircleCheck)
export const ArrowLeftIcon = adapt(ArrowLeft)
export const ArrowRightIcon = adapt(ArrowRight)
export const MoveFirstIcon = adapt(ArrowUpToLine)
export const MoveLastIcon = adapt(ArrowDownToLine)
export const ExplainIcon = adapt(Gauge)
export const MetricsIcon = adapt(Gauge)
export const FavoriteIcon = adapt(Star)
export const ReadOnlyIcon = adapt(ShieldCheck)
export const TableIcon = adapt(Table2)
export const JsonIcon = adapt(Braces)
export const ColumnIcon = adapt(Columns3)
export const KeyValueIcon = adapt(KeyRound)
export const ConsoleIcon = adapt(Terminal)
export const LightThemeIcon = adapt(Sun)
export const CopyIcon = adapt(Copy)
export const DownloadIcon = adapt(Download)
export const UploadIcon = adapt(Upload)
export const SaveIcon = adapt(Save)
export const HistoryIcon = adapt(History)
export const ClockIcon = adapt(Clock)
export const ColorIcon = adapt(Palette)
export const MoreIcon = adapt(MoreVertical)
export const TrashIcon = adapt(Trash2)
export const ShowIcon = adapt(Eye)
export const HideIcon = adapt(EyeOff)
